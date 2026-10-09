// Лише збирає дані: для кожної адреси з TARGETS пише в artifacts/result.json,
// чи є зараз екстрене/аварійне відключення. Telegram-сповіщення шле сервер (dtek_emergency.py),
// який забирає цей файл як artifact запуску.
import fs from "node:fs"
import path from "node:path"

import { chromium } from "playwright"

import { TARGETS, SITES, RESULT_FILE } from "./constants.js"
import { loadTargets } from "./helpers.js"

// Одна сторінка на сайт: CSRF-токен беремо раз, далі лише AJAX-запити по вулицях.
async function openSite(browser, site) {
  const page = await browser.newPage()
  await page.goto(SITES[site].page, { waitUntil: "load" })
  const tag = await page.waitForSelector('meta[name="csrf-token"]', {
    state: "attached",
  })
  return { page, csrfToken: await tag.getAttribute("content") }
}

async function fetchStreet({ page, csrfToken }, city, street) {
  return page.evaluate(
    async ({ city, street, csrfToken }) => {
      const formData = new URLSearchParams()
      formData.append("method", "getHomeNum")
      if (city) {
        formData.append("data[0][name]", "city")
        formData.append("data[0][value]", city)
      }
      formData.append("data[1][name]", "street")
      formData.append("data[1][value]", street)
      formData.append("data[2][name]", "updateFact")
      formData.append("data[2][value]", new Date().toLocaleString("uk-UA"))

      const response = await fetch("/ua/ajax", {
        method: "POST",
        headers: {
          "x-requested-with": "XMLHttpRequest",
          "x-csrf-token": csrfToken,
        },
        body: formData,
      })
      return await response.json()
    },
    { city, street, csrfToken }
  )
}

// Екстрене/аварійне відключення або null; планові не цікавлять.
function getEmergency(info, house) {
  if (!info?.data) throw Error("Power outage info missed")

  const { sub_type = "", start_date = "", end_date = "", type = "" } =
    info.data[house] || {}
  if (!sub_type && !start_date && !end_date && !type) return null

  const subType = sub_type.toLowerCase()
  if (!subType.includes("авар") && !subType.includes("екст")) return null

  return { sub_type, start_date, end_date }
}

async function run() {
  const targets = loadTargets(TARGETS)
  // У результаті лише id адрес: artifacts публічного репо може скачати будь-хто
  const result = { checked_at: new Date().toISOString(), targets: {} }
  let ok = true

  const browser = await chromium.launch({ headless: true })
  try {
    const sites = {}
    const streets = {}

    for (const t of targets) {
      try {
        sites[t.site] ??= openSite(browser, t.site)
        const site = await sites[t.site]

        const streetKey = `${t.site}|${t.city || ""}|${t.street}`
        streets[streetKey] ??= fetchStreet(site, t.city, t.street)
        const info = await streets[streetKey]

        const emergency = getEmergency(info, t.house)
        result.targets[t.id] = {
          ok: true,
          site: t.site,
          emergency,
          update_timestamp: info.updateTimestamp || null,
        }
        console.log(emergency ? `🚨 ${t.id}: ${emergency.start_date} — ${emergency.end_date}` : `⚡️ ${t.id}: no emergency`)
      } catch (error) {
        ok = false
        delete sites[t.site]
        result.targets[t.id] = { ok: false, site: t.site, error: error.message }
        console.error(`❌ ${t.id}: ${error.message}`)
      }
    }
  } finally {
    await browser.close()
    fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true })
    fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2) + "\n", "utf8")
  }

  if (!ok) process.exitCode = 1
}

run().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

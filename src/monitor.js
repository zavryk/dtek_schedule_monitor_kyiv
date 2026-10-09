// Лише збирає дані: для кожної адреси з TARGETS пише в artifacts/result.json,
// чи є зараз екстрене/аварійне відключення. Telegram-сповіщення шле сервер (dtek_emergency.py),
// який забирає цей файл як artifact запуску.
import fs from "node:fs"
import path from "node:path"

import { chromium } from "playwright"

import { TARGETS, SITES, RESULT_FILE } from "./constants.js"
import { loadTargets } from "./helpers.js"

// Під навантаженням сайт віддає заглушку, яка сама знімається - чекаємо до ~1.5 хв.
const PAGE_WAIT_MS = 90_000
const AJAX_ATTEMPTS = 6
const AJAX_RETRY_MS = 15_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function readCsrf(page) {
  try {
    const tag = await page.waitForSelector('meta[name="csrf-token"]', {
      state: "attached",
      timeout: PAGE_WAIT_MS,
    })
    return await tag.getAttribute("content")
  } catch (error) {
    // що саме показує сайт замість сторінки (заглушка, капча, помилка)
    const title = await page.title().catch(() => "?")
    const text = await page
      .evaluate(() => document.body?.innerText?.replace(/\s+/g, " ").slice(0, 200) ?? "")
      .catch(() => "?")
    throw Error(`no csrf-token at ${page.url()} (title "${title}", text "${text}")`)
  }
}

// Одна сторінка на сайт: CSRF-токен беремо раз, далі лише AJAX-запити по вулицях.
async function openSite(browser, site) {
  const page = await browser.newPage()
  await page.goto(SITES[site].page, { waitUntil: "load", timeout: PAGE_WAIT_MS })
  try {
    return { page, csrfToken: await readCsrf(page) }
  } catch (error) {
    console.log(`⏳ ${site}: ${error.message}; reloading`)
    await page.reload({ waitUntil: "load", timeout: PAGE_WAIT_MS })
    return { page, csrfToken: await readCsrf(page) }
  }
}

async function fetchStreet(site, city, street) {
  for (let attempt = 1; ; attempt++) {
    const { status, body } = await postStreet(site, city, street)
    try {
      const info = JSON.parse(body)
      if (info?.data) return info
      throw Error("no data in response")
    } catch (error) {
      if (attempt >= AJAX_ATTEMPTS) {
        throw Error(`ajax failed after ${attempt} attempts: HTTP ${status}, ${error.message}`)
      }
      console.log(`⏳ ajax HTTP ${status} (${error.message}), retry ${attempt}/${AJAX_ATTEMPTS - 1}`)
      await sleep(AJAX_RETRY_MS)
      // заглушка могла замінити сторінку або протухнув токен - перечитуємо
      await site.page.reload({ waitUntil: "load", timeout: PAGE_WAIT_MS })
      site.csrfToken = await readCsrf(site.page)
    }
  }
}

async function postStreet({ page, csrfToken }, city, street) {
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
      return { status: response.status, body: await response.text() }
    },
    { city, street, csrfToken }
  )
}

// Екстрене/аварійне відключення або null; планові не цікавлять.
function getEmergency(info, house) {
  if (!info?.data) throw Error("Power outage info missed")
  if (!(house in info.data)) {
    // без цього помилка в адресі виглядала б як "відключень немає"
    const prefix = String(house).match(/^\d+/)?.[0] ?? ""
    const similar = Object.keys(info.data).filter((h) => prefix && h.startsWith(prefix))
    throw Error(`house "${house}" not found; similar: ${similar.join(", ") || "none"}`)
  }

  const { sub_type = "", start_date = "", end_date = "", type = "" } =
    info.data[house]
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
        ok = false  // сайт, що не відкрився, у цьому запуску не повторюємо - решту адрес на ньому теж пропускаємо
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

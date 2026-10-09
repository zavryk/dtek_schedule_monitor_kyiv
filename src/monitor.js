import { chromium } from "playwright"

import { TELEGRAM_BOT_TOKEN, TARGETS, DRY_RUN, SITES } from "./constants.js"

import {
  capitalize,
  isQuietHoursKyiv,
  loadState,
  loadTargets,
  saveState,
  targetKey,
} from "./helpers.js"

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

// Повертає дані лише для екстреного/аварійного відключення, інакше null.
function getEmergency(info, house) {
  if (!info?.data) throw Error("❌ Power outage info missed.")

  const { sub_type = "", start_date = "", end_date = "", type = "" } =
    info.data[house] || {}
  if (!sub_type && !start_date && !end_date && !type) return null

  const subType = sub_type.toLowerCase()
  if (!subType.includes("авар") && !subType.includes("екст")) return null

  return { sub_type, start_date, end_date }
}

function generateMessage(t, { sub_type, start_date, end_date }, updateTimestamp) {
  const reason = capitalize(sub_type).replace(/екстренні/gi, "Екстрені")
  const [beginTime, beginDate] = start_date.split(" ")
  const [endTime, endDate] = end_date.split(" ")
  const period = `${beginTime} ${beginDate} — ${endTime} ${endDate}`
  const site = SITES[t.site]

  const text = [
    "🚨🚨 <b>Екстрене відключення:</b>",
    ...(t.showStreet ? ["", `📍 <b><u>${t.street}</u></b>`] : []),
    `<blockquote><code>🌑 ${beginTime} ${beginDate}\n🌕 ${endTime} ${endDate}</code></blockquote>`,
    "",
    `⚠️ <b>Причина: </b><i>${reason}.</i>`,
    "",
    `‼️ <b>Терміни орієнтовні</b>`,
    `🔄 <b>Оновлено: </b> <i>${updateTimestamp}</i>`,
    `🔗 <b>Джерело: </b><a href="${site.page}">${site.name}</a>`,
  ].join("\n")

  return { text, period }
}

async function sendMessage(chat, text, disable_notification) {
  const { id, thread } = typeof chat === "object" ? chat : { id: chat }
  const payload = { chat_id: id, text, parse_mode: "HTML", disable_notification }
  if (thread) payload.message_thread_id = Number(thread)

  const resp = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  )
  const data = await resp.json()
  if (!resp.ok || data.ok === false) {
    throw Error(`Telegram API error: ${data.description || resp.status}`)
  }
}

// Шле в ті чати, куди цей період ще не пішов; при збої одного чату решта не дублюються.
async function notify(t, entry, text, period) {
  if (entry.period !== period) {
    entry.period = period
    entry.sent = []
  }
  const disable_notification = isQuietHoursKyiv()
  let failed = false

  for (const chat of t.chats) {
    const id = String(typeof chat === "object" ? chat.id : chat)
    if (entry.sent.includes(id)) continue
    if (DRY_RUN) {
      entry.sent.push(id)
      console.log(`🧪 Dry run: marked as sent to ${id}`)
      continue
    }
    try {
      await sendMessage(chat, text, disable_notification)
      entry.sent.push(id)
      entry.updated_at = new Date().toISOString()
      console.log(`🟢 Sent${disable_notification ? " (silent)" : ""} to ${id}`)
    } catch (error) {
      failed = true
      console.error(`🔴 Not sent to ${id}: ${error.message}`)
    }
  }
  return !failed
}

async function run() {
  if (!TELEGRAM_BOT_TOKEN) throw Error("❌ Missing telegram bot token.")
  const targets = loadTargets(TARGETS)
  const state = loadState()
  let ok = true

  const browser = await chromium.launch({ headless: true })
  try {
    const sites = {}
    const streets = {}

    for (const [i, t] of targets.entries()) {
      const key = targetKey(t)
      const label = `#${i + 1} ${t.site}`
      try {
        sites[t.site] ??= openSite(browser, t.site)
        const site = await sites[t.site]

        const streetKey = `${t.site}|${t.city || ""}|${t.street}`
        streets[streetKey] ??= fetchStreet(site, t.city, t.street)
        const info = await streets[streetKey]

        const emergency = getEmergency(info, t.house)
        if (!emergency) {
          console.log(`⚡️ ${label}: no emergency outage`)
          continue
        }

        const { text, period } = generateMessage(t, emergency, info.updateTimestamp)
        const entry = (state[key] ??= {})
        if (entry.period === period && entry.sent?.length === t.chats.length) {
          console.log(`🟡 ${label}: period unchanged (${period})`)
          continue
        }

        console.log(`🚨 ${label}: ${period}`)
        if (!(await notify(t, entry, text, period))) ok = false
      } catch (error) {
        ok = false
        delete sites[t.site]
        console.error(`❌ ${label}: ${error.message}`)
      }
    }
  } finally {
    await browser.close()
    saveState(state)
  }

  if (!ok) process.exitCode = 1
}

run().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

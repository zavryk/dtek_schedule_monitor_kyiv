import path from "node:path"

export const { TELEGRAM_BOT_TOKEN, TARGETS } = process.env

// Перший запуск: записати поточні відключення у стан без відправки (щоб не дублювати старі репо)
export const DRY_RUN = process.env.DRY_RUN === "true"

export const SITES = {
  kem: {
    page: "https://www.dtek-kem.com.ua/ua/shutdowns",
    name: "ДТЕК КЕМ",
  },
  krem: {
    page: "https://www.dtek-krem.com.ua/ua/shutdowns",
    name: "ДТЕК КРЕМ",
  },
}

export const STATE_FILE = path.resolve("artifacts", "state.json")

// 00:00..06:29 за Києвом повідомлення без звуку
export const QUIET_UNTIL_MIN = 6 * 60 + 30

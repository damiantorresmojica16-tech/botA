const TelegramBot = require("node-telegram-bot-api");
const { getDb } = require("./db");
const { generateKey, expiresAt, expiresAtMinutes, formatExpiry } = require("./keyGen");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN no definido");

const bot = new TelegramBot(TOKEN, { polling: true });

// ─── Session helpers ──────────────────────────────────────────────────────────
function getSession(tid) {
  const db = getDb();
  let s = db.prepare("SELECT * FROM bot_sessions WHERE telegram_id = ?").get(tid);
  if (!s) { db.prepare("INSERT INTO bot_sessions (telegram_id,state) VALUES (?,?)").run(tid,"idle"); s = db.prepare("SELECT * FROM bot_sessions WHERE telegram_id = ?").get(tid); }
  return s;
}
function setSession(tid, state, userId, tempData) {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO bot_sessions (telegram_id,state,user_id,temp_data) VALUES (?,?,?,?)").run(tid, state, userId ?? null, tempData ? JSON.stringify(tempData) : null);
}
function getLoggedUser(tid) {
  const db = getDb();
  const s = getSession(tid);
  if (!s?.user_id) return null;
  return db.prepare("SELECT * FROM users WHERE id = ? AND banned = 0").get(s.user_id);
}

// ─── Keyboards ────────────────────────────────────────────────────────────────
const KB_LOGIN   = { reply_markup: { keyboard: [[{ text: "🔑 Login" }]], resize_keyboard: true } };
const KB_CANCEL  = { reply_markup: { keyboard: [[{ text: "❌ Cancelar" }]], resize_keyboard: true } };
const KB_CATEG   = { reply_markup: { keyboard: [[{ text: "🔑 GENERATE KEY" },{ text: "🚫 REVOKE KEY" }],[{ text: "🔄 RESET KEY" },{ text: "📋 KEYS ACTIVE" }],[{ text: "⏱ KEYS HOUR" },{ text: "🔙 VOLVER" }]], resize_keyboard: true } };
const KB_HOUR    = { reply_markup: { keyboard: [[{ text: "30 MIN" },{ text: "1 HORA" },{ text: "3 HORAS" }],[{ text: "6 HORAS" },{ text: "12 HORAS" },{ text: "24 HORAS" }],[{ text: "🔙 VOLVER" }]], resize_keyboard: true } };
const KB_PANEL   = { reply_markup: { keyboard: [[{ text: "➕ CREAR USUARIO" },{ text: "🔍 VER USUARIOS" }],[{ text: "🚫 BANEAR USUARIO" },{ text: "📊 STATS USUARIO" }],[{ text: "🔙 VOLVER" }]], resize_keyboard: true } };
const KB_COUNT   = { reply_markup: { keyboard: [[{ text: "1 KEY" },{ text: "2 KEYS" },{ text: "3 KEYS" }],[{ text: "4 KEYS" },{ text: "5 KEYS" }],[{ text: "🔙 VOLVER" }]], resize_keyboard: true } };

function mainMenu(role) {
  const rows = [[{ text: "🔑 GENERATE KEY" },{ text: "ℹ️ INFO" }]];
  if (role === "owner") rows.push([{ text: "🛠 PANEL OWNER" }]);
  return { reply_markup: { keyboard: rows, resize_keyboard: true } };
}

function dayButtons() {
  const rows = [];
  for (let i = 1; i <= 31; i += 7) {
    const row = [];
    for (let j = i; j < i + 7 && j <= 31; j++) row.push({ text: String(j) });
    rows.push(row);
  }
  rows.push([{ text: "🔙 VOLVER" }]);
  return { reply_markup: { keyboard: rows, resize_keyboard: true } };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const tid    = msg.from.id;
  const text   = (msg.text || "").trim();

  try {
    const sess  = getSession(tid);
    const state = sess?.state ?? "idle";

    // /start
    if (text === "/start") {
      const u = getLoggedUser(tid);
      if (u) return bot.sendMessage(chatId, `✅ Ya estás logueado como *${u.username}*`, { parse_mode: "Markdown", ...mainMenu(u.role) });
      setSession(tid, "idle");
      return bot.sendMessage(chatId, "❌ *You are not logged in!*\nType command /login", { parse_mode: "Markdown", ...KB_LOGIN });
    }

    // /login o botón Login
    if (text === "/login" || text === "🔑 Login") {
      setSession(tid, "awaiting_credentials");
      return bot.sendMessage(chatId, "🔒 *Enter the credentials provided by the administrator in the following format:*\n\n`LOGIN`\n`PASSWORD`", { parse_mode: "Markdown", ...KB_CANCEL });
    }

    // Cancelar
    if (text === "❌ Cancelar") {
      const u = getLoggedUser(tid);
      if (u) { setSession(tid, "logged_in", u.id); return bot.sendMessage(chatId, "❌ Cancelado.", mainMenu(u.role)); }
      setSession(tid, "idle");
      return bot.sendMessage(chatId, "❌ Cancelado.", KB_LOGIN);
    }

    // Volver
    if (text === "🔙 VOLVER") {
      const u = getLoggedUser(tid);
      if (u) { setSession(tid, "logged_in", u.id); return bot.sendMessage(chatId, "🏠 Menú principal", mainMenu(u.role)); }
      return;
    }

    // ── Credenciales ───────────────────────────────────────────────────────────
    if (state === "awaiting_credentials") {
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) return bot.sendMessage(chatId, "⚠️ Formato incorrecto:\n`LOGIN\nPASSWORD`", { parse_mode: "Markdown", ...KB_CANCEL });
      const [login, password] = lines;
      const db = getDb();
      const u = db.prepare("SELECT * FROM users WHERE username = ? AND password = ? AND banned = 0").get(login, password);
      if (!u) return bot.sendMessage(chatId, "❌ Credenciales incorrectas o usuario baneado.", KB_CANCEL);
      db.prepare("UPDATE users SET telegram_id = ? WHERE id = ?").run(tid, u.id);
      setSession(tid, "logged_in", u.id);
      return bot.sendMessage(chatId, `✅ *INICIO DE SESIÓN CON ÉXITO*\n\nBienvenido, *${u.username}* 👋`, { parse_mode: "Markdown", ...mainMenu(u.role) });
    }

    // ── Requiere login ─────────────────────────────────────────────────────────
    const user = getLoggedUser(tid);
    if (!user) return bot.sendMessage(chatId, "❌ *You are not logged in!*\nType command /login", { parse_mode: "Markdown", ...KB_LOGIN });

    // ── Botón GENERATE KEY ─────────────────────────────────────────────────────
    if (text === "🔑 GENERATE KEY") {
      if (state === "generate_category") {
        setSession(tid, "select_days", user.id);
        return bot.sendMessage(chatId, "📅 *SELECT DAYS OF KEY*", { parse_mode: "Markdown", ...dayButtons() });
      }
      setSession(tid, "generate_category", user.id);
      return bot.sendMessage(chatId, "🗂 *SELECCIONA UNA CATEGORÍA*", { parse_mode: "Markdown", ...KB_CATEG });
    }

    if (text === "ℹ️ INFO") {
      const db = getDb();
      const total  = db.prepare("SELECT COUNT(*) as c FROM keys WHERE created_by = ? AND revoked = 0").get(user.id).c;
      const active = db.prepare("SELECT COUNT(*) as c FROM keys WHERE created_by = ? AND revoked = 0 AND datetime(expires_at) > datetime('now')").get(user.id).c;
      return bot.sendMessage(chatId, `ℹ️ *INFO*\n\n👤 \`${user.username}\`\n🏷 Rol: \`${user.role}\`\n✅ Keys activas: \`${active}\`\n📦 Total: \`${total}\``, { parse_mode: "Markdown", ...mainMenu(user.role) });
    }

    if (text === "🛠 PANEL OWNER") {
      if (user.role !== "owner") return bot.sendMessage(chatId, "⛔ Sin permisos.", mainMenu(user.role));
      setSession(tid, "panel_owner", user.id);
      return bot.sendMessage(chatId, "👑 *PANEL OWNER*", { parse_mode: "Markdown", ...KB_PANEL });
    }

    // ── Categoría: acciones ────────────────────────────────────────────────────
    if (text === "⏱ KEYS HOUR") {
      setSession(tid, "select_hour", user.id);
      return bot.sendMessage(chatId, "⏱ *SELECCIONA LA DURACIÓN*", { parse_mode: "Markdown", ...KB_HOUR });
    }
    if (text === "🚫 REVOKE KEY") {
      setSession(tid, "awaiting_revoke_key", user.id);
      return bot.sendMessage(chatId, "🚫 Envía la key a *REVOCAR*:", { parse_mode: "Markdown", ...KB_CANCEL });
    }
    if (text === "🔄 RESET KEY") {
      setSession(tid, "awaiting_reset_key", user.id);
      return bot.sendMessage(chatId, "🔄 Envía la key a *RESETEAR*:", { parse_mode: "Markdown", ...KB_CANCEL });
    }
    if (text === "📋 KEYS ACTIVE") {
      const db = getDb();
      const keys = db.prepare("SELECT key_value,expires_at,device_id FROM keys WHERE created_by = ? AND revoked = 0 AND datetime(expires_at) > datetime('now') ORDER BY created_at DESC LIMIT 20").all(user.id);
      if (!keys.length) return bot.sendMessage(chatId, "📋 No tienes keys activas.", KB_CATEG);
      const lines = keys.map((k,i) => `${i+1}. \`${k.key_value}\`\n   ⏳ ${formatExpiry(k.expires_at)}  ${k.device_id ? "📱 En uso" : "🟢 Libre"}`);
      return bot.sendMessage(chatId, `📋 *KEYS ACTIVAS (${keys.length})*\n\n${lines.join("\n\n")}`, { parse_mode: "Markdown", ...KB_CATEG });
    }

    // ── Selección de días ──────────────────────────────────────────────────────
    if (state === "select_days") {
      const day = parseInt(text);
      if (!isNaN(day) && day >= 1 && day <= 31) {
        setSession(tid, "select_count_days", user.id, { days: day });
        return bot.sendMessage(chatId, `🔢 *CUANTAS KEYS* — ${day} día${day>1?"s":""}`, { parse_mode: "Markdown", ...KB_COUNT });
      }
    }

    // ── Selección de hora ──────────────────────────────────────────────────────
    if (state === "select_hour") {
      const hourMap = { "30 MIN":30,"1 HORA":60,"3 HORAS":180,"6 HORAS":360,"12 HORAS":720,"24 HORAS":1440 };
      if (hourMap[text] !== undefined) {
        setSession(tid, "select_count_hours", user.id, { minutes: hourMap[text], label: text });
        return bot.sendMessage(chatId, `🔢 *CUANTAS KEYS* — ${text}`, { parse_mode: "Markdown", ...KB_COUNT });
      }
    }

    // ── Generar keys por días ──────────────────────────────────────────────────
    if (state === "select_count_days") {
      const m = text.match(/^(\d+)\s*KEYS?$/i);
      if (m) {
        const count = parseInt(m[1]);
        const td    = sess.temp_data ? JSON.parse(sess.temp_data) : {};
        const days  = td.days ?? 1;
        const db    = getDb();
        const generated = [];
        for (let i = 0; i < count; i++) {
          const k = generateKey();
          db.prepare("INSERT INTO keys (key_value,created_by,expires_at) VALUES (?,?,?)").run(k, user.id, expiresAt(days));
          generated.push(k);
        }
        setSession(tid, "generate_category", user.id);
        return bot.sendMessage(chatId, `✅ *${count} KEY${count>1?"S":""} GENERADA${count>1?"S":""}*\n⏳ *${days} día${days>1?"s":""}*\n\n${generated.map(k=>`\`${k}\``).join("\n")}`, { parse_mode: "Markdown", ...KB_CATEG });
      }
    }

    // ── Generar keys por horas ─────────────────────────────────────────────────
    if (state === "select_count_hours") {
      const m = text.match(/^(\d+)\s*KEYS?$/i);
      if (m) {
        const count   = parseInt(m[1]);
        const td      = sess.temp_data ? JSON.parse(sess.temp_data) : {};
        const minutes = td.minutes ?? 60;
        const label   = td.label ?? "";
        const db      = getDb();
        const generated = [];
        for (let i = 0; i < count; i++) {
          const k = generateKey();
          db.prepare("INSERT INTO keys (key_value,created_by,expires_at) VALUES (?,?,?)").run(k, user.id, expiresAtMinutes(minutes));
          generated.push(k);
        }
        setSession(tid, "generate_category", user.id);
        return bot.sendMessage(chatId, `✅ *${count} KEY${count>1?"S":""} GENERADA${count>1?"S":""}*\n⏳ *${label}*\n\n${generated.map(k=>`\`${k}\``).join("\n")}`, { parse_mode: "Markdown", ...KB_CATEG });
      }
    }

    // ── Revocar key ────────────────────────────────────────────────────────────
    if (state === "awaiting_revoke_key") {
      const db = getDb();
      const k = db.prepare("SELECT * FROM keys WHERE key_value = ? AND created_by = ?").get(text, user.id);
      if (!k) return bot.sendMessage(chatId, "❌ Key no encontrada o no te pertenece.", KB_CANCEL);
      db.prepare("UPDATE keys SET revoked=1,device_id=NULL,active_session_id=NULL WHERE id=?").run(k.id);
      setSession(tid, "generate_category", user.id);
      return bot.sendMessage(chatId, `🚫 *KEY REVOCADA*\n\n\`${text}\``, { parse_mode: "Markdown", ...KB_CATEG });
    }

    // ── Resetear key ───────────────────────────────────────────────────────────
    if (state === "awaiting_reset_key") {
      const db = getDb();
      const k = db.prepare("SELECT * FROM keys WHERE key_value = ? AND created_by = ?").get(text, user.id);
      if (!k) return bot.sendMessage(chatId, "❌ Key no encontrada o no te pertenece.", KB_CANCEL);
      db.prepare("UPDATE keys SET device_id=NULL,active_session_id=NULL WHERE id=?").run(k.id);
      setSession(tid, "generate_category", user.id);
      return bot.sendMessage(chatId, `🔄 *KEY RESETEADA*\n\n\`${text}\`\n\n✅ El dispositivo fue desconectado. La key está disponible para otro dispositivo.`, { parse_mode: "Markdown", ...KB_CATEG });
    }

    // ── Panel Owner ────────────────────────────────────────────────────────────
    if (state === "panel_owner" || state === "owner_create_user" || state === "owner_ban_user" || state === "owner_stats_user") {
      if (user.role !== "owner") return bot.sendMessage(chatId, "⛔ Sin permisos.", mainMenu(user.role));

      if (text === "➕ CREAR USUARIO") {
        setSession(tid, "owner_create_user", user.id);
        return bot.sendMessage(chatId, "➕ *CREAR USUARIO*\n\nFormato:\n`USERNAME\nPASSWORD\nROL`\n\nROL: `admin`", { parse_mode: "Markdown", ...KB_CANCEL });
      }
      if (text === "🔍 VER USUARIOS") {
        const db = getDb();
        const users = db.prepare("SELECT username,role,banned FROM users ORDER BY id").all();
        const lines = users.map(u => `👤 \`${u.username}\` — ${u.role}${u.banned?" 🚫":""}`)
        return bot.sendMessage(chatId, `👥 *USUARIOS*\n\n${lines.join("\n")}`, { parse_mode: "Markdown", ...KB_PANEL });
      }
      if (text === "🚫 BANEAR USUARIO") {
        setSession(tid, "owner_ban_user", user.id);
        return bot.sendMessage(chatId, "🚫 Envía el *username* a banear/desbanear:", { parse_mode: "Markdown", ...KB_CANCEL });
      }
      if (text === "📊 STATS USUARIO") {
        setSession(tid, "owner_stats_user", user.id);
        return bot.sendMessage(chatId, "📊 Envía el *username* para ver sus stats:", { parse_mode: "Markdown", ...KB_CANCEL });
      }

      if (state === "owner_create_user") {
        const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
        if (lines.length < 3) return bot.sendMessage(chatId, "⚠️ Formato:\n`USERNAME\nPASSWORD\nROL`", { parse_mode:"Markdown", ...KB_CANCEL });
        const [uname,pwd,rol] = lines;
        if (!["admin","owner"].includes(rol.toLowerCase())) return bot.sendMessage(chatId, "❌ Rol inválido. Usa: `admin`", { parse_mode:"Markdown", ...KB_CANCEL });
        try {
          getDb().prepare("INSERT INTO users (username,password,role) VALUES (?,?,?)").run(uname,pwd,rol.toLowerCase());
          setSession(tid, "panel_owner", user.id);
          return bot.sendMessage(chatId, `✅ Usuario \`${uname}\` creado — rol \`${rol}\``, { parse_mode:"Markdown", ...KB_PANEL });
        } catch { return bot.sendMessage(chatId, "❌ Ese username ya existe.", KB_CANCEL); }
      }

      if (state === "owner_ban_user") {
        const db = getDb();
        const target = db.prepare("SELECT * FROM users WHERE username = ?").get(text);
        if (!target) return bot.sendMessage(chatId, "❌ Usuario no encontrado.", KB_CANCEL);
        if (target.role === "owner") return bot.sendMessage(chatId, "❌ No puedes banear al owner.", KB_CANCEL);
        const newBan = target.banned ? 0 : 1;
        db.prepare("UPDATE users SET banned = ? WHERE id = ?").run(newBan, target.id);
        setSession(tid, "panel_owner", user.id);
        return bot.sendMessage(chatId, newBan ? `🚫 \`${text}\` BANEADO.` : `✅ \`${text}\` DESBANEADO.`, { parse_mode:"Markdown", ...KB_PANEL });
      }

      if (state === "owner_stats_user") {
        const db = getDb();
        const target = db.prepare("SELECT * FROM users WHERE username = ?").get(text);
        if (!target) return bot.sendMessage(chatId, "❌ Usuario no encontrado.", KB_CANCEL);
        const total   = db.prepare("SELECT COUNT(*) as c FROM keys WHERE created_by = ?").get(target.id).c;
        const active  = db.prepare("SELECT COUNT(*) as c FROM keys WHERE created_by = ? AND revoked=0 AND datetime(expires_at)>datetime('now')").get(target.id).c;
        const revoked = db.prepare("SELECT COUNT(*) as c FROM keys WHERE created_by = ? AND revoked=1").get(target.id).c;
        setSession(tid, "panel_owner", user.id);
        return bot.sendMessage(chatId, `📊 *${target.username}*\n\n🔑 Total: \`${total}\`\n✅ Activas: \`${active}\`\n🚫 Revocadas: \`${revoked}\`\n🏷 Rol: \`${target.role}\`\n${target.banned?"🔴 Baneado":"🟢 Activo"}`, { parse_mode:"Markdown", ...KB_PANEL });
      }
    }

  } catch (err) {
    console.error("[BOT ERROR]", err.message);
    try { bot.sendMessage(msg.chat.id, "⚠️ Error interno. Intenta de nuevo."); } catch {}
  }
});

// Limpiar keys expiradas cada minuto
setInterval(() => {
  try {
    getDb().prepare("UPDATE keys SET device_id=NULL,active_session_id=NULL WHERE revoked=0 AND datetime(expires_at)<=datetime('now') AND device_id IS NOT NULL").run();
  } catch {}
}, 60000);

console.log("[BOT] Telegram bot iniciado");
module.exports = bot;

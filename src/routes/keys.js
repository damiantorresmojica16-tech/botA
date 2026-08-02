const express = require("express");
const { getDb } = require("../db");
const { isExpired } = require("../keyGen");
const router = express.Router();

router.post("/keys/validate", (req, res) => {
  const { key, deviceId, sessionId } = req.body;
  if (!key || !deviceId || !sessionId) return res.status(400).json({ valid: false, error: "Missing fields" });

  const db = getDb();
  const record = db.prepare("SELECT * FROM keys WHERE key_value = ?").get(key);
  if (!record)           return res.status(401).json({ valid: false, error: "Key no encontrada" });
  if (record.revoked)    return res.status(401).json({ valid: false, error: "Key revocada" });
  if (isExpired(record.expires_at)) return res.status(401).json({ valid: false, error: "Key expirada" });
  if (record.device_id && record.device_id !== deviceId)
    return res.status(401).json({ valid: false, error: "Key ya en uso en otro dispositivo" });

  db.prepare("UPDATE keys SET device_id = ?, active_session_id = ? WHERE id = ?")
    .run(deviceId, sessionId, record.id);

  res.json({ valid: true, keyName: key, expiresAt: record.expires_at, deviceId });
});

router.post("/keys/check-session", (req, res) => {
  const { key, sessionId } = req.body;
  if (!key || !sessionId) return res.status(400).json({ valid: false });

  const db = getDb();
  const record = db.prepare("SELECT * FROM keys WHERE key_value = ?").get(key);
  if (!record || record.revoked || isExpired(record.expires_at))
    return res.status(401).json({ valid: false, error: "Sesión inválida" });
  if (record.active_session_id !== sessionId)
    return res.status(401).json({ valid: false, error: "Sesión reemplazada" });

  res.json({ valid: true });
});

router.post("/keys/release", (req, res) => {
  const { key, sessionId } = req.body;
  if (!key || !sessionId) return res.status(400).json({ ok: false });

  const db = getDb();
  const record = db.prepare("SELECT * FROM keys WHERE key_value = ? AND active_session_id = ?").get(key, sessionId);
  if (record) db.prepare("UPDATE keys SET device_id = NULL, active_session_id = NULL WHERE id = ?").run(record.id);
  res.json({ ok: true });
});

module.exports = router;

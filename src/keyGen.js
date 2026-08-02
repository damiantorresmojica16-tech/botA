const crypto = require("crypto");

const PREFIXES = ["Widman iOS","Widman Pro","Widman VIP","Widman Elite","Widman Plus"];

function generateKey() {
  const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
  const p1 = crypto.randomBytes(6).toString("hex").toUpperCase();
  const p2 = crypto.randomBytes(6).toString("hex").toUpperCase();
  const p3 = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${p1}-${p2}-${p3}`;
}

function expiresAt(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function expiresAtMinutes(minutes) {
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

function isExpired(expiresAtStr) {
  return new Date(expiresAtStr) < new Date();
}

function formatExpiry(expiresAtStr) {
  const diffMs = new Date(expiresAtStr).getTime() - Date.now();
  if (diffMs <= 0) return "EXPIRADA";
  const days  = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  const mins  = Math.floor((diffMs % 3600000) / 60000);
  if (days > 0)  return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

module.exports = { generateKey, expiresAt, expiresAtMinutes, isExpired, formatExpiry };

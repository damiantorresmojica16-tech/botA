require("dotenv").config();
require("./bot");
const express = require("express");
const cors    = require("cors");
const keysRouter = require("./routes/keys");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
app.use("/api", keysRouter);

app.listen(PORT, () => console.log(`[API] Server on port ${PORT}`));

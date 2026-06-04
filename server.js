const express = require("express");
const cors = require("cors");

const app = express();

const simulationRoutes = require("./routes/simulations");
const geminiRoutes = require('./routes/gemini.route');

app.use(cors());
app.use(express.json());

app.use("/api/simulations", simulationRoutes);
app.use('/api/gemini', geminiRoutes);

// KODE BARU: Deteksi otomatis port dari server, jika tidak ada gunakan 5000
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});
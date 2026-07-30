const { Worker } = require('worker_threads');
const path = require('path');
const axios = require('axios');

exports.evaluasiSkripsi = async (req, res) => {
    try {
        const pdfBuffer = req.file ? req.file.buffer : null;
        const teksMahasiswa = req.body.teks_mahasiswa;

        if (!pdfBuffer) {
            return res.status(400).json({ error: "File PDF tidak ditemukan." });
        }

        const workerPath = path.resolve(__dirname, 'tfidfWorker.js');
        const worker = new Worker(workerPath, {
            workerData: { pdfBuffer, teksMahasiswa }
        });

        worker.on('message', async (result) => {
            if (!result.success) {
                return res.status(500).json({ error: "Gagal memproses dokumen PDF." });
            }

            const threshold = 0.02; 
            
            if (result.skor < threshold) {
                return res.json({
                    skor_kesesuaian: result.skor,
                    status_akhir: "TIDAK NYAMBUNG / OUT OF TOPIC (Diblokir oleh sistem PDF)",
                    skor_pede: 0,
                    status_pede: "Tidak Diketahui"
                });
            }

            try {
                const aiResponse = await axios.post("https://frameszans-skripsivibe-ai.hf.space/api/prediksi", {
                    teks_mahasiswa: teksMahasiswa
                });

                return res.json({
                    skor_kesesuaian: result.skor,
                    evaluasi_ai: aiResponse.data,
                    status_akhir: "Evaluasi Sukses"
                });

            } catch (aiError) {
                return res.status(500).json({ error: "Server AI Hugging Face gangguan." });
            }
        });

        worker.on('error', (err) => {
            return res.status(500).json({ error: "Worker Thread Error", detail: err.message });
        });

    } catch (error) {
        res.status(500).json({ error: "Terjadi kesalahan server." });
    }
};
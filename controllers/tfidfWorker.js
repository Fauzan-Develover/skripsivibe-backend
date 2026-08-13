const { parentPort, workerData } = require('worker_threads');
const pdfParse = require('pdf-parse');
const natural = require('natural');

async function processSimilarity() {
    try {
        const { pdfBuffer, teksMahasiswa } = workerData;
        
        // 1. Ekstrak teks dari PDF utuh
        const pdfData = await pdfParse(pdfBuffer);
        const teksSkripsi = pdfData.text;

        // 2. Inisialisasi TF-IDF dan hitung matriks
        const TfIdf = natural.TfIdf;
        const tfidf = new TfIdf();
        
        tfidf.addDocument(teksSkripsi);
        tfidf.addDocument(teksMahasiswa);

        // 3. Kalkulasi Cosine Similarity Manual (Pendekatan Sederhana)
        // Kita menghitung bobot kata dari teks mahasiswa terhadap dokumen skripsi
        let skorMatch = 0;
        const termWeights = {};
        
        // Ambil term (kata) dari teks mahasiswa
        const tokenizer = new natural.WordTokenizer();
        const tokens = tokenizer.tokenize(teksMahasiswa.toLowerCase());
        
        tokens.forEach(token => {
            tfidf.tfidfs(token, function(i, measure) {
                // measure adalah bobot term pada dokumen ke-i
                if (i === 0) skorMatch += measure; // Bobot kata mahasiswa di dalam teks skripsi
            });
        });

        // Normalisasi skor (semakin panjang jawaban yang relevan, skor meningkat)
        // Batas threshold bisa disesuaikan, kita konversi agar setara dengan skor 0.02 Python
        const skorNormalisasi = skorMatch / (tokens.length || 1);

        // 🔥 PERBAIKAN: Tambahkan teks_pdf agar bisa dikirim ke Hugging Face
        parentPort.postMessage({ 
            success: true, 
            skor: skorNormalisasi,
            teks_pdf: teksSkripsi 
        });
    } catch (error) {
        parentPort.postMessage({ success: false, error: error.message });
    }
}

processSimilarity();
const express = require("express");
const router = express.Router();

const { db } = require("../firebaseAdmin");


// SIMPAN SIMULASI
router.post("/", async (req, res) => {
  try {
    const data = req.body;

    const docRef = await db
      .collection("simulations")
      .add({
        ...data,
        createdAt: new Date(),
      });

    res.json({
      success: true,
      id: docRef.id,
    });

  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

router.get("/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;

    // HANYA gunakan where (Lolos dari blokir index Firebase)
    const snapshot = await db
      .collection("simulations")
      .where("uid", "==", uid)
      .get();

    const simulations = [];

    snapshot.forEach((doc) => {
      simulations.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    // Urutkan data secara manual di JavaScript
    simulations.sort((a, b) => {
      const timeA = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
      const timeB = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
      return timeB - timeA; 
    });

    res.json(simulations);

  } catch (error) {
    // Memunculkan error di terminal agar tidak membisu
    console.error("🔥 ERROR BACKEND:", error);
    
    // Kirim array kosong agar frontend React (DashboardUser) tidak crash 
    res.status(200).json([]); 
  }
});

module.exports = router;
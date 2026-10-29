import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputDir = path.join(__dirname, '..', 'Knowledge');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function createStyledPDF(filename, title, sections) {
  const doc = new PDFDocument({
    margin: 50,
    size: 'A4',
    bufferPages: true,
    info: {
      Title: title,
      Author: 'SISMart Team',
    }
  });

  const filePath = path.join(outputDir, filename);
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Colors
  const primaryColor = '#0284c7'; // Sky Blue
  const secondaryColor = '#0369a1';
  const textColor = '#334155'; // Slate 700
  const headerColor = '#0f172a'; // Slate 900
  const dividerColor = '#cbd5e1'; // Slate 300

  // Title Page / Top Header
  doc.fillColor(primaryColor)
     .fontSize(22)
     .text('SISMART KNOWLEDGE BASE', { align: 'center' });
  doc.fillColor(textColor)
     .fontSize(10)
     .text('Dokumentasi Resmi & Panduan Spesialis Konten (AI)', { align: 'center' })
     .moveDown(1.5);

  // Title of the Document
  doc.fillColor(headerColor)
     .fontSize(16)
     .text(title.toUpperCase(), { align: 'left' });

  // Divider
  doc.moveTo(50, doc.y + 5)
     .lineTo(545, doc.y + 5)
     .strokeColor(dividerColor)
     .stroke()
     .moveDown(1.5);

  // Content rendering
  sections.forEach(section => {
    // Add page if near bottom
    if (doc.y > 700) {
      doc.addPage();
    }

    doc.fillColor(headerColor)
       .fontSize(12)
       .text(section.heading)
       .moveDown(0.5);

    section.paragraphs.forEach(p => {
      if (doc.y > 720) {
        doc.addPage();
      }

      if (p.startsWith('- ')) {
        // Bullet point
        doc.fillColor(textColor)
           .fontSize(10)
           .text(p, {
             align: 'justify',
             indent: 15,
             lineGap: 4
           });
      } else {
        doc.fillColor(textColor)
           .fontSize(10)
           .text(p, {
             align: 'justify',
             lineGap: 4
           });
      }
      doc.moveDown(0.8);
    });

    doc.moveDown(1);
  });

  // Footer on each page (using page events)
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    
    // Draw a small footer line
    doc.moveTo(50, 800)
       .lineTo(545, 800)
       .strokeColor(dividerColor)
       .stroke();

    doc.fillColor('#64748b')
       .fontSize(8)
       .text('SISMart - Aplikasi Kasir Offline-First untuk UMKM Indonesia', 50, 808, { align: 'left' });
    
    doc.text(`Halaman ${i + 1} dari ${range.count}`, 50, 808, { align: 'right' });
  }

  doc.end();
  
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

const documents = [
  {
    filename: 'brand-guideline.pdf',
    title: 'Brand Guideline - Panduan Identitas Brand',
    sections: [
      {
        heading: '1. Pendahuluan & Visi Misi',
        paragraphs: [
          'SISMart adalah aplikasi Point of Sale (POS) gratis, offline-first, dan open-source yang dirancang khusus untuk membantu Usaha Mikro, Kecil, dan Menengah (UMKM) di Indonesia. Aplikasi ini dibuat dengan filosofi bahwa teknologi kasir modern harus dapat diakses oleh siapa saja tanpa hambatan biaya atau infrastruktur internet.',
          'Misi utama SISMart adalah mempercepat digitalisasi warung, toko kelontong, retail kecil, dan usaha kuliner (F&B) dengan menyediakan alat pencatatan penjualan dan stok yang andal, aman, dan sepenuhnya berada di bawah kendali pemilik usaha sendiri.'
        ]
      },
      {
        heading: '2. Persona & Nada Suara (Tone of Voice)',
        paragraphs: [
          'Dalam membuat konten tentang SISMart, gunakan nada suara yang: Ramah & Dekat (gunakan sapaan hangat seperti "Teman SISMart" atau "Rekan UMKM"), Solutif & Praktis (fokus pada penyelesaian masalah nyata di warung), serta Sederhana & Bebas Jargon (jelaskan istilah keuangan dengan cara yang merakyat).',
          'Kami ingin merchant merasa didukung dan diberdayakan, bukan merasa terintimidasi oleh teknologi rumit. Jangan gunakan istilah bahasa Inggris jika ada padanan bahasa Indonesia yang umum digunakan oleh pedagang lokal.'
        ]
      },
      {
        heading: '3. Elemen Visual & Identitas Brand',
        paragraphs: [
          'Logo: Logo SISMart memadukan ikon mesin kasir klasik dengan senyuman hangat, melambangkan kepuasan dan kemudahan bertransaksi.',
          'Warna Utama: Sky Blue (#0284c7) mewakili kepercayaan, keandalan, dan langit cerah yang melambangkan masa depan cerah UMKM. Warna sekunder adalah Emerald Green (#10b981) mewakili kesuksesan finansial, keuntungan, dan pertumbuhan usaha.',
          'Tipografi: Huruf utama yang digunakan dalam aplikasi dan materi publikasi adalah Plus Jakarta Sans. Huruf ini memberikan kesan modern, bersih, dan sangat mudah dibaca baik di layar HP maupun cetakan struk.'
        ]
      }
    ]
  },
  {
    filename: 'content-guideline.pdf',
    title: 'Content Guideline - Panduan Penulisan Konten',
    sections: [
      {
        heading: '1. Tujuan Panduan Konten',
        paragraphs: [
          'Panduan ini dibuat untuk memandu Content Specialist (AI) dalam menyusun tulisan, artikel, postingan media sosial, maupun materi promosi SISMart agar selaras dengan nilai-nilai brand dan mudah dicerna oleh target audiens.',
          'Fokus utama adalah membumikan teknologi kasir modern agar dipahami oleh pemilik warung kelontong tradisional, pedagang pasar, dan pelaku usaha rumahan.'
        ]
      },
      {
        heading: '2. Glosarium & Istilah Baku',
        paragraphs: [
          '- Aplikasi Kasir Offline: Istilah pengganti "Offline POS". Menekankan bahwa aplikasi tetap berfungsi tanpa kuota internet.',
          '- HPP (Harga Pokok Penjualan): Harus selalu dijelaskan sebagai "modal awal barang" agar pedagang tidak bingung.',
          '- Struk thermal: Istilah untuk kertas kasir kecil yang dicetak menggunakan printer Bluetooth panas tanpa tinta.',
          '- Open Bill: Disebut juga "Simpan Transaksi" atau "Pesanan Gantung" untuk mencatat pesanan meja yang belum dibayar.'
        ]
      },
      {
        heading: '3. Struktur Penulisan Konten',
        paragraphs: [
          'Gunakan struktur yang ringkas dan padat. Awali dengan masalah nyata (misal: "Stok barang sering hilang misterius?"), berikan solusi menggunakan fitur SISMart, dan akhiri dengan ajakan bertindak (Call to Action) yang jelas.',
          'Gunakan tabel perbandingan jika menjelaskan perbedaan fitur offline gratis dan fitur Cloud Sync opsional. Gunakan bullet points untuk mempermudah pemindaian informasi secara visual.'
        ]
      }
    ]
  },
  {
    filename: 'feature-cashier.pdf',
    title: 'Feature cashier - Fitur POS / Kasir',
    sections: [
      {
        heading: '1. Ringkasan Fitur POS / Kasir',
        paragraphs: [
          'Modul POS / Kasir adalah jantung dari SISMart. Modul ini dirancang dengan antarmuka yang sangat responsif, mendukung tampilan portrait untuk smartphone dan landscape (split-screen) untuk tablet.',
          'Pengguna dapat memproses transaksi dengan cepat melalui pencarian produk, tap kategori, atau memindai barcode barang menggunakan kamera perangkat secara instan.'
        ]
      },
      {
        heading: '2. Operasional Keranjang & Pembayaran',
        paragraphs: [
          'Keranjang belanja mendukung penyesuaian kuantiti secara cepat, pemberian diskon per barang (nominal atau persentase), pemberian diskon global untuk total transaksi, serta penambahan catatan khusus per barang.',
          'Metode pembayaran didesain fleksibel: Tunai dengan tombol cepat kembalian (auto-calculating change), dan Non-Tunai (Transfer, Debit, atau QRIS) untuk pencatatan transaksi digital.'
        ]
      },
      {
        heading: '3. Fitur Unggulan: Open Bill',
        paragraphs: [
          'Open Bill memungkinkan kasir menyimpan transaksi yang sedang berjalan tanpa harus langsung menyelesaikannya. Fitur ini sangat cocok untuk bisnis F&B (restoran/kafe) di mana pelanggan memesan dulu dan membayar nanti.',
          'Transaksi Open Bill dapat diberi nama pelanggan, nomor meja, serta catatan tambahan. Struk order draft juga bisa dicetak untuk diberikan ke bagian dapur.'
        ]
      }
    ]
  },
  {
    filename: 'feature-product.pdf',
    title: 'Feature Product - Fitur Kelola Produk',
    sections: [
      {
        heading: '1. Manajemen Produk & Kategori',
        paragraphs: [
          'SISMart menyediakan fitur manajemen produk (CRUD) yang lengkap untuk merapikan katalog dagangan. Pengguna dapat mengelompokkan produk ke dalam Kategori untuk mempercepat pencarian di halaman kasir.',
          'Setiap produk memiliki field wajib seperti Nama Produk, SKU (Stock Keeping Unit) unik, Unit Satuan, Harga Beli (untuk perhitungan HPP), dan Harga Jual.'
        ]
      },
      {
        heading: '2. Penggunaan Barcode & Gambar',
        paragraphs: [
          'Untuk mempercepat transaksi, pengguna dapat mengaitkan kode barcode (EAN-13, UPC, Code-128, dll) pada produk. Pengisian barcode bisa dilakukan manual atau dengan memindai barcode fisik menggunakan kamera langsung di halaman edit produk.',
          'Foto produk juga dapat diunggah dan disimpan langsung di database lokal IndexedDB, sehingga gambar tetap tampil meskipun perangkat dalam keadaan offline tanpa internet.'
        ]
      },
      {
        heading: '3. Master Satuan Barang',
        paragraphs: [
          'Fitur Master Satuan memungkinkan pengguna mengelola unit pengukuran (seperti Pcs, Botol, Dus, Sachet, Porsi) secara terpusat.',
          'Terdapat sistem keamanan (delete guard) yang mencegah penghapusan satuan jika satuan tersebut masih digunakan oleh produk aktif, guna menjaga integritas data transaksi.'
        ]
      }
    ]
  },
  {
    filename: 'feature-stock.pdf',
    title: 'Feature Stock - Fitur Manajemen Stok',
    sections: [
      {
        heading: '1. Manajemen Persediaan Barang',
        paragraphs: [
          'Modul persediaan barang (stok) di SISMart dirancang untuk meminimalkan selisih stok dan menghitung modal usaha secara akurat.',
          'Sistem mencatat setiap riwayat perubahan stok untuk memberikan transparansi penuh atas arus keluar masuk barang di gudang atau toko.'
        ]
      },
      {
        heading: '2. Fitur Stok Masuk (Stock In) & HPP Otomatis',
        paragraphs: [
          'Stok Masuk digunakan untuk mencatat pembelian barang dari pemasok (supplier). Pengguna memasukkan jumlah barang masuk dan harga beli terbaru.',
          'SISMart menggunakan metode Rata-Rata Tertimbang (Weighted Average) untuk menghitung Harga Pokok Penjualan (HPP) secara otomatis setiap kali ada stok masuk baru. Hal ini memastikan perhitungan laba rugi tetap akurat meskipun harga kulakan naik-turun.'
        ]
      },
      {
        heading: '3. Fitur Stok Keluar (Stock Out) & Supplier',
        paragraphs: [
          'Stok Keluar digunakan untuk mencatat pengurangan stok non-penjualan, seperti barang rusak, hilang, kedaluwarsa, diretur ke supplier, atau digunakan untuk keperluan pribadi (prive).',
          'Manajemen Supplier membantu mencatat kontak pemasok secara lengkap, memudahkan pemesanan ulang barang ketika persediaan menipis.'
        ]
      }
    ]
  },
  {
    filename: 'feature-report.pdf',
    title: 'Feature Report - Fitur Laporan',
    sections: [
      {
        heading: '1. Laporan Penjualan & Keuangan',
        paragraphs: [
          'SISMart menyediakan dasbor laporan yang intuitif untuk membantu pemilik usaha memantau kesehatan bisnis mereka tanpa perlu keahlian akuntansi.',
          'Laporan dirancang visual menggunakan grafik interaktif yang menampilkan tren penjualan harian dalam rentang waktu 7 hari atau 30 hari terakhir.'
        ]
      },
      {
        heading: '2. Analisis Keuntungan & Produk Terlaris',
        paragraphs: [
          'Sistem menyajikan metrik keuangan penting secara real-time: Pendapatan Kotor (Total Omzet), Total HPP (Modal Barang Terjual), Laba Kotor, dan Laba Bersih setelah dikurangi diskon.',
          'Daftar Produk Terlaris membantu pemilik toko mengetahui produk mana yang paling cepat berputar (fast-moving), sehingga mereka bisa merencanakan stok dengan lebih baik.'
        ]
      },
      {
        heading: '3. Riwayat Transaksi & Ekspor Data',
        paragraphs: [
          'Halaman riwayat transaksi menampilkan daftar seluruh transaksi belanja lengkap dengan status pembayaran dan detail barang. Pengguna juga dapat melakukan pembatalan transaksi (refund) yang otomatis mengembalikan stok barang.',
          'Seluruh laporan dan data transaksi dapat diekspor menjadi dokumen Excel (.xlsx) untuk pembukuan eksternal atau diunduh dalam format JSON untuk cadangan.'
        ]
      }
    ]
  },
  {
    filename: 'feature-cloud.pdf',
    title: 'Feature Cloud - Fitur Sinkronisasi Cloud',
    sections: [
      {
        heading: '1. Pengenalan Dashboard Cloud SISMart',
        paragraphs: [
          'SISMart didesain offline-first, namun untuk bisnis yang berkembang, tersedia layanan sinkronisasi cloud opsional melalui dashboard web.',
          'Dengan Cloud Sync, data transaksi yang tersimpan di IndexedDB perangkat lokal akan otomatis disinkronisasikan ke database cloud (PostgreSQL/MySQL) secara aman begitu ada koneksi internet.'
        ]
      },
      {
        heading: '2. Pemantauan Multi-Toko & Area Owner',
        paragraphs: [
          'Melalui dashboard web, Owner Toko dapat memantau performa penjualan beberapa cabang toko secara real-time dari jarak jauh menggunakan laptop atau HP, tanpa perlu mengganggu kasir yang sedang bekerja di toko fisik.',
          'Laporan konsolidasi memudahkan analisis performa antar cabang, manajemen lisensi langganan, dan pengunduhan laporan keuangan gabungan.'
        ]
      },
      {
        heading: '3. Paket Langganan & Area Admin',
        paragraphs: [
          '- Plan Sync 1 Toko: Rp 19.500 per bulan (kapasitas 1 toko aktif).',
          '- Plan Sync 2 Toko: Rp 29.000 per bulan (kapasitas hingga 2 toko).',
          '- Plan Sync 5 Toko: Rp 49.000 per bulan (kapasitas hingga 5 toko).',
          '- Plan Sync Unlimited: Rp 99.000 per bulan (toko tidak terbatas).',
          'Admin Area khusus untuk tim internal disediakan untuk mengelola data pengguna, memantau riwayat pembayaran, serta melacak kesehatan sinkronisasi database.'
        ]
      }
    ]
  },
  {
    filename: 'feature-market.pdf',
    title: 'Feature Market - Integrasi & Perangkat Keras',
    sections: [
      {
        heading: '1. Ekosistem Cetak Struk Bluetooth',
        paragraphs: [
          'Cetak struk belanja fisik sangat penting untuk membangun kepercayaan pelanggan. SISMart mendukung pencetakan langsung ke printer thermal Bluetooth portabel.',
          'Untuk PWA (versi web di browser Chrome Android/Desktop), aplikasi memanfaatkan teknologi Web Bluetooth. Untuk aplikasi native Android (APK), aplikasi menggunakan Classic Bluetooth via plugin Capacitor untuk konektivitas yang lebih stabil di latar belakang.'
        ]
      },
      {
        heading: '2. Fleksibilitas Struk Digital',
        paragraphs: [
          'Selain cetak fisik, SISMart menyediakan opsi struk digital yang ramah lingkungan. Kasir dapat membagikan struk belanja dalam bentuk gambar PNG hasil render dinamis.',
          'Gambar struk dapat dibagikan secara instan ke WhatsApp pelanggan, email, atau aplikasi chat lainnya melalui menu share bawaan perangkat.'
        ]
      },
      {
        heading: '3. Catatan Pembayaran Digital',
        paragraphs: [
          'SISMart mencatat pembayaran digital (QRIS, GoPay, OVO, ShopeePay, Transfer Bank) secara manual untuk memisahkan pembukuan uang tunai di laci kasir dan uang di rekening bank.'
        ]
      }
    ]
  },
  {
    filename: 'feature-settings.pdf',
    title: 'Feature Settings - Fitur Pengaturan',
    sections: [
      {
        heading: '1. Pengaturan Toko & Printer',
        paragraphs: [
          'Halaman Pengaturan adalah pusat kendali aplikasi SISMart di mana pengguna dapat menyesuaikan aplikasi dengan karakteristik unik bisnis mereka.',
          'Pengguna dapat mengatur Profil Toko (Nama, Alamat, No. Telp, Footer Struk), memilih lebar kertas struk thermal (58mm atau 80mm), menghubungkan printer Bluetooth default, serta mengaktifkan cetak struk otomatis setiap kali pembayaran selesai.'
        ]
      },
      {
        heading: '2. Mode Multi-User & Hak Akses Staff',
        paragraphs: [
          'Untuk toko yang memiliki karyawan, Owner dapat mengaktifkan Mode Multi-User. Fitur ini memungkinkan Owner membuat akun khusus untuk Staff dengan hak akses terbatas.',
          'Staff hanya bisa mengakses halaman Kasir dan Riwayat Transaksi dasar, serta dilarang melihat laporan keuntungan, mengedit harga barang, atau melakukan refund stok. Staff login menggunakan kode PIN 4-6 digit yang aman.'
        ]
      },
      {
        heading: '3. Manajemen Backup Lokal & Tampilan',
        paragraphs: [
          'Guna menghindari kehilangan data akibat kerusakan HP, pengguna dapat melakukan ekspor cadangan (backup) seluruh database lokal ke file JSON untuk disimpan di Google Drive atau flashdisk secara mandiri.',
          'Pengaturan tampilan mendukung peralihan Tema Gelap (Dark Mode) otomatis serta pilihan warna aksen aplikasi (Biru, Hijau, Ungu, Oranye) untuk kenyamanan mata pengguna.'
        ]
      }
    ]
  },
  {
    filename: 'faq.pdf',
    title: 'FAQ - Tanya Jawab Umum',
    sections: [
      {
        heading: '1. Pertanyaan Umum Tentang Lisensi & Biaya',
        paragraphs: [
          'Q: Apakah SISMart benar-benar gratis?\nA: Ya, 100% gratis selamanya untuk seluruh fitur kasir offline, pengelolaan produk, manajemen stok, laporan penjualan lokal, dan cetak struk Bluetooth.',
          'Q: Mengapa ada fitur berbayar?\nA: Fitur berbayar hanya berlaku untuk Cloud Sync (sinkronisasi cloud opsional) bagi pemilik toko yang ingin memantau laporan tokonya dari jarak jauh via internet.'
        ]
      },
      {
        heading: '2. Pertanyaan Teknis & Penggunaan Offline',
        paragraphs: [
          'Q: Apakah saya perlu koneksi internet untuk bertransaksi?\nA: Tidak. Seluruh data disimpan langsung di dalam HP atau komputer Anda menggunakan teknologi IndexedDB. Anda bisa bertransaksi penuh di daerah tanpa sinyal internet.',
          'Q: Bagaimana jika HP saya hilang atau rusak?\nA: Jika Anda menggunakan versi offline murni, Anda harus rajin melakukan backup JSON secara manual dari menu Pengaturan. Jika Anda berlangganan Cloud Sync, data Anda aman di server cloud dan bisa dipulihkan kapan saja.'
        ]
      },
      {
        heading: '3. Pertanyaan Perangkat Keras (Hardware)',
        paragraphs: [
          'Q: Jenis printer apa saja yang didukung oleh SISMart?\nA: Printer thermal mini (ukuran kertas 58mm atau 80mm) yang mendukung perintah standard ESC/POS dengan koneksi Bluetooth.',
          'Q: Bagaimana cara memindai barcode produk?\nA: Anda bisa langsung menggunakan kamera HP/tablet Anda melalui scanner bawaan di kasir, atau mencolokkan scanner barcode USB/Bluetooth eksternal ke perangkat Anda.'
        ]
      }
    ]
  },
  {
    filename: 'release-notes.pdf',
    title: 'Release Notes - Catatan Rilis Versi',
    sections: [
      {
        heading: '1. Catatan Rilis Versi 1.0.x s/d 1.1.x',
        paragraphs: [
          'v1.0.0: Rilis perdana aplikasi kasir SISMart. Fitur kasir dasar offline, manajemen produk sederhana dengan kategori, laporan penjualan harian, dan database lokal menggunakan Dexie.js.',
          'v1.1.0: Penambahan fitur Open Bill (pesanan gantung), dukungan bahasa penuh (Bahasa Indonesia, English, Bahasa Malaysia), serta pilihan warna aksen tema visual aplikasi.'
        ]
      },
      {
        heading: '2. Catatan Rilis Versi 1.2.x s/d 1.3.x',
        paragraphs: [
          'v1.2.0: Penambahan modul stok masuk dan keluar, integrasi data supplier, cetak struk Bluetooth (Web Bluetooth untuk PWA), dan perhitungan HPP otomatis dengan metode Rata-Rata Tertimbang.',
          'v1.3.0: Rilis fitur Multi-User. Pemilik toko dapat mendaftarkan staff dengan PIN khusus dan hak akses granular untuk membatasi staf melihat laporan keuangan atau mengubah harga jual.'
        ]
      },
      {
        heading: '3. Catatan Rilis Versi 1.4.x (Terbaru)',
        paragraphs: [
          'v1.4.0: Integrasi native platform menggunakan Capacitor 8 untuk membuat aplikasi Android APK resmi. Penambahan integrasi Cloud Sync opsional yang terhubung ke REST API backend untuk cadangan otomatis dan akses dashboard web.'
        ]
      }
    ]
  },
  {
    filename: 'roadmap.pdf',
    title: 'Roadmap - Rencana Pengembangan Masa Depan',
    sections: [
      {
        heading: '1. Rencana Pengembangan Kuartal 3 & 4 (2026)',
        paragraphs: [
          'Q3 2026 - Rilis Google Play Store & Google Drive Backup:\n- Merilis aplikasi Android secara resmi di Google Play Store untuk kemudahan instalasi.\n- Menambahkan fitur backup otomatis database lokal langsung ke akun Google Drive pribadi pengguna secara gratis.',
          'Q4 2026 - Multi-Kasir Wi-Fi & QRIS Dinamis:\n- Mengembangkan fitur multi-kasir lokal yang dapat tersinkronisasi antar perangkat dalam satu toko menggunakan jaringan Wi-Fi lokal tanpa perlu kuota internet.\n- Integrasi QRIS dinamis yang otomatis mencetak kode QR pembayaran unik sesuai dengan total belanjaan di struk kasir.'
        ]
      },
      {
        heading: '2. Rencana Pengembangan Kuartal 1 & 2 (2027)',
        paragraphs: [
          'Q1 2027 - AI Sales Forecasting:\n- Memanfaatkan kecerdasan buatan (AI) lokal untuk menganalisis tren penjualan dan memberikan rekomendasi pembelian stok barang kepada pemilik toko.',
          'Q2 2027 - Integrasi Ongkir & Pengiriman:\n- Integrasi dengan API ekspedisi pengiriman lokal Indonesia untuk mempermudah perhitungan ongkos kirim langsung dari aplikasi kasir untuk pesanan delivery.'
        ]
      }
    ]
  }
];

async function generateAll() {
  console.log('Memulai pembuatan PDF knowledge...');
  for (const doc of documents) {
    try {
      const p = await createStyledPDF(doc.filename, doc.title, doc.sections);
      console.log(`Berhasil membuat: ${p}`);
    } catch (e) {
      console.error(`Gagal membuat ${doc.filename}:`, e);
    }
  }
  console.log('Semua PDF knowledge berhasil dibuat!');
}

generateAll();

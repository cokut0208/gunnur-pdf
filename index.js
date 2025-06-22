const express = require('express');
// DİKKAT: Artık 'puppeteer-core' kullanıyoruz
const puppeteer = require('puppeteer-core');
// DİKKAT: Render için özel Chrome paketini ekledik
const chromium = require('@sparticuz/chromium');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// PDF OLUŞTURMA İÇİN YARDIMCI FONKSİYON
// Bu fonksiyon, HTML içeriğini alıp PDF'e dönüştürür.
const createPdfFromHtml = async (htmlContent) => {
    let browser;
    try {
        // Puppeteer'ı, Render.com için özel olarak kurduğumuz
        // harici Chrome paketi ile başlatıyoruz. Bu, en stabil yöntemdir.
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        return pdfBuffer;
    } finally {
        // İşlem bittiğinde veya hata oluştuğunda tarayıcıyı kapat.
        if (browser) {
            await browser.close();
        }
    }
};

// ==============================================================================
// API YOLU 1: SİPARİŞ FORMU OLUŞTURMA (/api/generate/order)
// ==============================================================================
app.post('/api/generate/order', async (req, res) => {
    try {
        const { order, customer, orderItems, logoBase64 } = req.body;
        let html = fs.readFileSync(path.join(__dirname, 'order-template.html'), 'utf-8');

        // --- ŞABLONDAKİ TÜM VERİLERİ DOLDUR ---

        // Genel Bilgiler
        html = html.replace('{{logoBase64}}', logoBase64 || '');
        html = html.replace('{{orderId}}', order.id.slice(0, 8) || 'Bilinmiyor');
        html = html.replace('{{orderDate}}', new Date(order.order_date).toLocaleDateString('tr-TR'));

        // Müşteri Bilgileri
        html = html.replace('{{customerName}}', `${customer.first_name || ''} ${customer.last_name || ''}`);
        html = html.replace('{{customerPhone}}', customer.phone || 'Belirtilmemiş');
        html = html.replace('{{customerEmail}}', customer.email || 'Belirtilmemiş');
        html = html.replace('{{customerTC}}', customer.tc_identity || 'Belirtilmemiş');
        html = html.replace('{{customerAddress}}', customer.address || 'Belirtilmemiş');
        
        // Sipariş Detayları
        html = html.replace('{{paymentMethod}}', order.payment_method || 'Belirtilmemiş');
        html = html.replace('{{orderStatus}}', order.status || 'Belirtilmemiş');
        html = html.replace('{{chassisNumber}}', order.chassis_number || 'N/A');
        html = html.replace('{{notes}}', order.notes || 'Yok');

        // Ürün Listesini HTML Tablo Satırlarına Çevir
        const itemsHtml = orderItems.map(item => {
            const product = item.product || {};
            let variantsText = '';
            if (product.variants) {
                try {
                    const variants = JSON.parse(product.variants);
                    const colors = variants.colors ? `Renk: ${variants.colors.join(', ')}` : '';
                    variantsText = colors;
                } catch (e) { /* ignore */ }
            }

            return `
                <tr>
                    <td>
                        <strong>${product.name || ''}</strong><br>
                        <small>Model: ${product.model || ''}</small>
                    </td>
                    <td><small>${variantsText}</small></td>
                    <td style="text-align:center;">${item.quantity}</td>
                    <td style="text-align:right;">₺${item.unit_price.toLocaleString('tr-TR')}</td>
                    <td style="text-align:right;">₺${item.total_price.toLocaleString('tr-TR')}</td>
                </tr>
            `;
        }).join('');
        html = html.replace('{{orderItems}}', itemsHtml);

        // Ödeme Özeti
        html = html.replace('{{subTotal}}', order.total_amount.toLocaleString('tr-TR'));
        html = html.replace('{{paidAmount}}', order.paid_amount.toLocaleString('tr-TR'));
        html = html.replace('{{remainingAmount}}', order.remaining_amount.toLocaleString('tr-TR'));
        html = html.replace('{{totalAmount}}', order.total_amount.toLocaleString('tr-TR'));
        
        // PDF'i oluştur
        const pdfBuffer = await createPdfFromHtml(html);
        
        // Oluşturulan PDF'i istemciye gönder
        res.set({ 'Content-Type': 'application/pdf', 'Content-Length': pdfBuffer.length }).send(pdfBuffer);
    } catch (error) {
        console.error('Sipariş PDF hatası:', error);
        res.status(500).send('Sipariş PDF oluşturulamadı. Sunucu loglarını kontrol edin.');
    }
});


// ==============================================================================
// API YOLU 2: GÜN SONU RAPORU OLUŞTURMA (/api/generate/day-end)
// ==============================================================================
app.post('/api/generate/day-end', async (req, res) => {
    try {
        const { report } = req.body;
        let html = fs.readFileSync(path.join(__dirname, 'day-end-template.html'), 'utf-8');

        // --- ŞABLONDAKİ TÜM VERİLERİ DOLDUR ---
        
        const formatLira = (amount) => (amount || 0).toLocaleString('tr-TR');

        // Header Bilgileri
        html = html.replace('{{cashierName}}', report.cashier.name || '');
        html = html.replace('{{targetCashierName}}', report.targetCashier?.name || 'Merkez');
        html = html.replace('{{reportDate}}', new Date(report.date).toLocaleDateString('tr-TR'));

        // Özet Kutuları
        html = html.replace('{{openingBalance}}', formatLira(report.openingBalance));
        html = html.replace('{{netAmount}}', formatLira(report.netAmount));
        html = html.replace('{{transferredAmount}}', formatLira(report.transferredAmount));
        html = html.replace('{{closingBalance}}', formatLira(report.closingBalance));
        
        // Gelir Dağılımı
        html = html.replace('{{totalIncome}}', formatLira(report.totalIncome));
        html = html.replace('{{cashIncome}}', formatLira(report.cashTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)));
        html = html.replace('{{cardIncome}}', formatLira(report.cardTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)));
        html = html.replace('{{transferIncome}}', formatLira(report.transferTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)));

        // Gider Dağılımı
        html = html.replace('{{totalExpense}}', formatLira(report.totalExpense));
        html = html.replace('{{cashExpense}}', formatLira(report.cashTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)));
        html = html.replace('{{cardExpense}}', formatLira(report.cardTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)));
        html = html.replace('{{transferExpense}}', formatLira(report.transferTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)));
        
        // İstatistikler
        const totalTransactions = report.cashTransactions.length + report.cardTransactions.length + report.transferTransactions.length;
        const avgTransactionAmount = totalTransactions > 0 ? (report.totalIncome + report.totalExpense) / totalTransactions : 0;
        const maxIncome = Math.max(...[...report.cashTransactions, ...report.cardTransactions, ...report.transferTransactions].filter(t => t.type === 'income').map(t => t.amount), 0);

        html = html.replace('{{totalTransactions}}', totalTransactions);
        html = html.replace('{{orderCount}}', report.orderCount);
        html = html.replace('{{avgTransactionAmount}}', formatLira(avgTransactionAmount));
        html = html.replace('{{maxIncome}}', formatLira(maxIncome));
        
        html = html.replace('{{generationDate}}', new Date().toLocaleString('tr-TR'));

        const pdfBuffer = await createPdfFromHtml(html);
        res.set({ 'Content-Type': 'application/pdf', 'Content-Length': pdfBuffer.length }).send(pdfBuffer);
    } catch (error) {
        console.error('Gün sonu PDF hatası:', error);
        res.status(500).send('Gün sonu PDF oluşturulamadı. Sunucu loglarını kontrol edin.');
    }
});

// SUNUCUYU BAŞLAT
app.listen(port, () => {
    console.log(`PDF servisi http://localhost:${port} adresinde çalışıyor`);
});


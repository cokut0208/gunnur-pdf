const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// TEKRAR EDEN PDF OLUŞTURMA İŞLEMİ İÇİN YARDIMCI FONKSİYON
const createPdfFromHtml = async (htmlContent) => {
    let browser;
    try {
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
        if (browser) {
            await browser.close();
        }
    }
};

// SİPARİŞ FORMU OLUŞTURMA API YOLU
app.post('/api/generate/order', async (req, res) => {
    try {
        const { order, customer, orderItems, logoBase64 } = req.body;
        let html = fs.readFileSync(path.join(__dirname, 'order-template.html'), 'utf-8');

        const formatLira = (amount) => (amount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
        const paymentMethods = { cash: 'Nakit', credit_card: 'Kredi Kartı', bank_transfer: 'Havale', installment: 'Taksitli', credit: 'Kredili' };
        const statusLabels = { draft: 'Taslak', confirmed: 'Onaylandı', completed: 'Tamamlandı', cancelled: 'İptal' };

        // --- ŞABLONDAKİ TÜM VERİLERİ DOLDUR ---

        html = html.replace('{{logoBase64}}', logoBase64 || '');
        html = html.replace('{{orderId}}', order.id.slice(0, 8) || '');
        html = html.replace('{{orderDate}}', new Date(order.order_date).toLocaleDateString('tr-TR'));
        
        // Müşteri Bilgileri
        html = html.replace(/{{customerName}}/g, `${customer.first_name || ''} ${customer.last_name || ''}`);
        html = html.replace('{{customerPhone}}', customer.phone || 'Belirtilmemiş');
        html = html.replace('{{customerEmail}}', customer.email || 'Belirtilmemiş');
        html = html.replace('{{customerTC}}', customer.tc_identity || 'Belirtilmemiş');
        html = html.replace('{{customerTCSerial}}', customer.tc_serial || 'N/A'); // Yeni eklenen seri no
        html = html.replace('{{customerAddress}}', customer.address || 'Belirtilmemiş');
        
        // Sipariş ve Ödeme Detayları
        html = html.replace('{{orderStatus}}', statusLabels[order.status] || order.status);
        html = html.replace('{{downPaymentAmount}}', formatLira(order.paid_amount)); // Peşinat ödenen tutardır
        html = html.replace('{{downPaymentMethod}}', paymentMethods[order.payment_method] || order.payment_method); // Siparişin ana ödeme yöntemi peşinat yöntemi olarak kabul edilir
        html = html.replace('{{remainingAmount}}', formatLira(order.remaining_amount));
        html = html.replace('{{remainingPaymentMethod}}', paymentMethods[order.payment_method] || order.payment_method); // Bu alanı gerekirse frontend'den ayrı bir veri olarak alabilirsiniz. Şimdilik ana metodu kullanıyoruz.


        // Ürün Listesini HTML Tablo Satırlarına Çevir
        const itemsHtml = orderItems.map(item => {
            const product = item.product || {};
            // Seçilen varyantları (renk, yıl) birleştirerek tek bir string yap
            const variantInfo = [item.selectedVariant.color, item.selectedVariant.modelYear].filter(Boolean).join(' / ');

            return `
                <tr>
                    <td>${product.name || ''} ${product.model || ''}</td>
                    <td>${variantInfo || 'Standart'}</td>
                    <td>${item.chassis_number || 'N/A'}</td>
                    <td style="text-align:center;">${item.quantity}</td>
                    <td style="text-align:right;">₺${formatLira(item.unit_price)}</td>
                    <td style="text-align:right;">₺${formatLira(item.total_price)}</td>
                </tr>
            `;
        }).join('');
        html = html.replace('{{orderItems}}', itemsHtml);

        // Ödeme Özeti
        html = html.replace('{{subTotal}}', formatLira(order.total_amount));
        html = html.replace('{{paidAmount}}', formatLira(order.paid_amount));
        html = html.replace('{{totalAmount}}', formatLira(order.total_amount));
        
        const pdfBuffer = await createPdfFromHtml(html);
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


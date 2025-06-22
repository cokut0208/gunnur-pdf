const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// TEKRAR EDEN PDF OLUŞTURMA İŞLEMİ İÇİN YARDIMCI FONKSİYON
const createPdfFromHtml = async (htmlContent) => {
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();
    return pdfBuffer;
};

// API YOLU 1: SİPARİŞ FORMU OLUŞTURMA
app.post('/api/generate/order', async (req, res) => {
    try {
        const { order, customer, orderItems, logoBase64 } = req.body;
        let html = fs.readFileSync(path.join(__dirname, 'order-template.html'), 'utf-8');

        // Sipariş şablonundaki verileri doldur...
        // ... (Bu kısım bir önceki cevaptakiyle aynı, uzun olmaması için eklenmedi) ...
        html = html.replace('{{logoBase64}}', logoBase64 || '');
        html = html.replace('{{orderId}}', order.id.slice(0, 8) || '');
        html = html.replace('{{orderDate}}', new Date(order.order_date).toLocaleDateString('tr-TR') || '');
        // Diğer tüm {{...}} alanları da burada replace edilecek.

        const pdfBuffer = await createPdfFromHtml(html);
        res.set({ 'Content-Type': 'application/pdf', 'Content-Length': pdfBuffer.length }).send(pdfBuffer);
    } catch (error) {
        console.error('Sipariş PDF hatası:', error);
        res.status(500).send('Sipariş PDF oluşturulamadı.');
    }
});

// API YOLU 2: GÜN SONU RAPORU OLUŞTURMA
app.post('/api/generate/day-end', async (req, res) => {
    try {
        const { report } = req.body; // Frontend'den sadece 'report' objesi gelecek
        let html = fs.readFileSync(path.join(__dirname, 'day-end-template.html'), 'utf-8');

        // Gün sonu şablonundaki verileri doldur
        html = html.replace('{{cashierName}}', report.cashier.name || '');
        html = html.replace('{{targetCashierName}}', report.targetCashier?.name || 'Merkez');
        html = html.replace('{{reportDate}}', new Date(report.date).toLocaleDateString('tr-TR'));
        html = html.replace('{{openingBalance}}', report.openingBalance.toLocaleString('tr-TR'));
        html = html.replace('{{netAmount}}', report.netAmount.toLocaleString('tr-TR'));
        html = html.replace('{{transferredAmount}}', report.transferredAmount.toLocaleString('tr-TR'));
        html = html.replace('{{closingBalance}}', report.closingBalance.toLocaleString('tr-TR'));
        
        html = html.replace('{{totalIncome}}', report.totalIncome.toLocaleString('tr-TR'));
        html = html.replace('{{cashIncome}}', report.cashTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0).toLocaleString('tr-TR'));
        html = html.replace('{{cardIncome}}', report.cardTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0).toLocaleString('tr-TR'));
        html = html.replace('{{transferIncome}}', report.transferTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0).toLocaleString('tr-TR'));

        html = html.replace('{{totalExpense}}', report.totalExpense.toLocaleString('tr-TR'));
        html = html.replace('{{cashExpense}}', report.cashTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0).toLocaleString('tr-TR'));
        html = html.replace('{{cardExpense}}', report.cardTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0).toLocaleString('tr-TR'));
        html = html.replace('{{transferExpense}}', report.transferTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0).toLocaleString('tr-TR'));
        
        const totalTransactions = report.cashTransactions.length + report.cardTransactions.length + report.transferTransactions.length;
        html = html.replace('{{totalTransactions}}', totalTransactions);
        html = html.replace('{{orderCount}}', report.orderCount);
        html = html.replace('{{avgTransactionAmount}}', (totalTransactions > 0 ? (report.totalIncome + report.totalExpense) / totalTransactions : 0).toLocaleString('tr-TR'));
        html = html.replace('{{maxIncome}}', Math.max(...[...report.cashTransactions, ...report.cardTransactions, ...report.transferTransactions].filter(t => t.type === 'income').map(t => t.amount), 0).toLocaleString('tr-TR'));
        
        html = html.replace('{{generationDate}}', new Date().toLocaleString('tr-TR'));

        const pdfBuffer = await createPdfFromHtml(html);
        res.set({ 'Content-Type': 'application/pdf', 'Content-Length': pdfBuffer.length }).send(pdfBuffer);
    } catch (error) {
        console.error('Gün sonu PDF hatası:', error);
        res.status(500).send('Gün sonu PDF oluşturulamadı.');
    }
});

app.listen(port, () => {
    console.log(`PDF servisi http://localhost:${port} adresinde çalışıyor`);
});

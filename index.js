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

// Tek tarayıcı örneğini yönetmek için yardımcı fonksiyon
let browserInstance = null;
const getBrowserInstance = async () => {
    if (browserInstance && browserInstance.isConnected()) {
        return browserInstance;
    }
    console.log('Tarayıcı örneği başlatılıyor...');
    browserInstance = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    });
    browserInstance.on('disconnected', () => { browserInstance = null; });
    console.log('Tarayıcı başarıyla başlatıldı.');
    return browserInstance;
};

// HTML içeriğinden PDF oluşturmak için yardımcı fonksiyon
const createPdfFromHtml = async (htmlContent) => {
    const browser = await getBrowserInstance();
    const page = await browser.newPage();
    try {
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        return pdfBuffer;
    } finally {
        await page.close();
    }
};

// ==============================================================================
// API YOLU: SİPARİŞ FORMU OLUŞTURMA
// ==============================================================================
app.post('/api/generate/order', async (req, res) => {
    try {
        const { order, customer, orderItems, logoBase64 } = req.body;
        let html = fs.readFileSync(path.join(__dirname, 'order-template.html'), 'utf-8');

        const formatLira = (amount) => (amount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
        const paymentMethods = { cash: 'Nakit', credit_card: 'Kredi Kartı', bank_transfer: 'Havale', installment: 'Taksitli', credit: 'Kredili' };
        const statusLabels = { draft: 'Taslak', confirmed: 'Onaylandı', completed: 'Tamamlandı', cancelled: 'İptal' };

        // İndirim ve orijinal tutar hesaplamaları
        const totalOriginalAmount = orderItems.reduce((sum, item) => sum + ((item.original_price || 0) * (item.quantity || 1)), 0);
        const totalDiscountAmount = orderItems.reduce((sum, item) => sum + ((item.discount_amount || 0) * (item.quantity || 1)), 0);
        
        // Şablondaki genel verileri doldurma
        html = html.replace('{{logoBase64}}', logoBase64 || '');
        html = html.replace('{{orderId}}', order.id.slice(0, 8) || 'Bilinmiyor');
        html = html.replace('{{orderDate}}', new Date(order.order_date).toLocaleDateString('tr-TR'));
        html = html.replace(/{{customerName}}/g, `${customer.first_name || ''} ${customer.last_name || ''}`);
        html = html.replace('{{customerPhone}}', customer.phone || 'Belirtilmemiş');
        html = html.replace('{{customerEmail}}', customer.email || 'Belirtilmemiş');
        html = html.replace('{{customerTC}}', customer.tc_identity || 'Belirtilmemiş');
        html = html.replace('{{customerTCSerial}}', customer.tc_serial || 'N/A');
        html = html.replace('{{customerAddress}}', customer.address || 'Belirtilmemiş');
        html = html.replace('{{orderStatus}}', statusLabels[order.status] || order.status);
        html = html.replace('{{downPaymentAmount}}', formatLira(order.paid_amount));
        html = html.replace('{{downPaymentMethod}}', paymentMethods[order.payment_method] || order.payment_method);
        html = html.replace('{{remainingAmount}}', formatLira(order.remaining_amount));
        html = html.replace('{{remainingPaymentMethod}}', paymentMethods[order.payment_method] || order.payment_method);

        // Sipariş kalemleri için HTML oluşturma
        const itemsHtml = orderItems.map(item => {
            const product = item.product || {};
            const details = item.details || {};
            const selectedVariant = details.selectedVariant || {};

            const color = selectedVariant.color || '-';
            const modelYear = selectedVariant.modelYear || '-';
            const chassis_number = details.chassis_number || 'N/A';
            
            const discountInfoHtml = item.discount_amount > 0 
                ? `<br><span class="discount-text">(Orijinal Fiyat: ₺${formatLira(item.original_price)}, İndirim: -₺${formatLira(item.discount_amount)})</span>`
                : '';

            return `
                <tr>
                    <td>
                        ${product.name || ''} ${product.model || ''}
                        ${discountInfoHtml}
                    </td>
                    <td>${color}</td>
                    <td>${modelYear}</td>
                    <td>${chassis_number}</td>
                    <td style="text-align:center;">${item.quantity}</td>
                    <td style="text-align:right;">₺${formatLira(item.unit_price)}</td>
                    <td style="text-align:right;">₺${formatLira(item.total_price)}</td>
                </tr>
            `;
        }).join('');
        html = html.replace('{{orderItems}}', itemsHtml);

        // Ödeme özeti için indirim HTML'ini oluşturma
        let discountSummaryHtml = '';
        if (totalDiscountAmount > 0) {
            discountSummaryHtml = `
                <tr>
                    <td>Orijinal Toplam:</td>
                    <td style="text-align:right;">₺${formatLira(totalOriginalAmount)}</td>
                </tr>
                <tr class="discount-total">
                    <td>Toplam İndirim:</td>
                    <td style="text-align:right;">-₺${formatLira(totalDiscountAmount)}</td>
                </tr>
            `;
        }
        html = html.replace('{{discountSummary}}', discountSummaryHtml);

        // Genel toplamları doldurma
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
// API YOLU: GÜN SONU RAPORU OLUŞTURMA
// ==============================================================================
app.post('/api/generate/day-end', async (req, res) => {
    try {
        const { report } = req.body;
        let html = fs.readFileSync(path.join(__dirname, 'day-end-template.html'), 'utf-8');
        const formatLira = (amount) => (amount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
        
        // Gün sonu verilerini doldurma
        html = html.replace('{{cashierName}}', report.cashier.name || '');
        html = html.replace('{{targetCashierName}}', report.targetCashier?.name || 'Merkez');
        html = html.replace('{{reportDate}}', new Date(report.date).toLocaleDateString('tr-TR'));
        html = html.replace('{{openingBalance}}', formatLira(report.openingBalance));
        html = html.replace('{{netAmount}}', formatLira(report.netAmount));
        html = html.replace('{{transferredAmount}}', formatLira(report.transferredAmount));
        html = html.replace('{{closingBalance}}', formatLira(report.closingBalance));
        html = html.replace('{{totalIncome}}', formatLira(report.totalIncome));
        html = html.replace('{{cashIncome}}', formatLira(report.cashTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)));
        html = html.replace('{{cardIncome}}', formatLira(report.cardTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)));
        html = html.replace('{{transferIncome}}', formatLira(report.transferTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)));
        html = html.replace('{{totalExpense}}', formatLira(report.totalExpense));
        html = html.replace('{{cashExpense}}', formatLira(report.cashTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)));
        html = html.replace('{{cardExpense}}', formatLira(report.cardTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)));
        html = html.replace('{{transferExpense}}', formatLira(report.transferTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)));
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

// Sunucuyu başlatma
app.listen(port, () => {
    console.log(`PDF servisi http://localhost:${port} adresinde çalışıyor`);
});
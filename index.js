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

app.post('/api/generate/order', async (req, res) => {
    try {
        const { order, customer, orderItems, paymentItems, logoBase64 } = req.body;
        let html = fs.readFileSync(path.join(__dirname, 'order-template.html'), 'utf-8');

        const formatLira = (amount) => (amount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const statusLabels = { draft: 'Taslak', confirmed: 'Onaylandı', completed: 'Tamamlandı', cancelled: 'İptal' };

        // Toplamları doğrudan sipariş kalemlerinden hesapla
        const subTotal = orderItems.reduce((sum, item) => sum + (item.original_price || 0) * (item.quantity || 1), 0);
        const totalDiscount = orderItems.reduce((sum, item) => sum + (item.discount_amount || 0) * (item.quantity || 1), 0);
        
        // Genel verileri doldur
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

        // Sipariş kalemleri HTML'ini oluştur
        const itemsHtml = orderItems.map(item => {
            const product_name = item.product_name || 'Bilinmeyen Ürün';
            const color = item.selectedVariant?.color || '-';
            const modelYear = item.selectedVariant?.modelYear || '-';
            const chassis_number = item.chassis_number || 'N/A';
            
            const discountDescription = item.manual_discount_description 
                ? `Manuel İndirim: ${item.manual_discount_description}` 
                : item.discount_name || '';

            const discountInfoHtml = (item.discount_amount || 0) > 0 
                ? `<br><span class="discount-text">(İndirim: -₺${formatLira(item.discount_amount)} ${discountDescription ? ` - ${discountDescription}` : ''})</span>`
                : '';

            return `
                <tr>
                    <td>${product_name} ${discountInfoHtml}</td>
                    <td>${color} / ${modelYear}</td>
                    <td style="text-align:center;">${item.quantity}</td>
                    <td style="text-align:right;">₺${formatLira(item.unit_price)}</td>
                    <td style="text-align:right;">₺${formatLira(item.total_price)}</td>
                </tr>
                <tr>
                    <td colspan="5" style="font-size: 7pt; padding-top:0; border-bottom: 1px solid #ddd;"><strong>Şasi No:</strong> ${chassis_number}</td>
                </tr>`;
        }).join('');
        html = html.replace('{{orderItems}}', itemsHtml);

        // Ödeme detayları HTML'ini oluştur
        const paymentDetailsHtml = (paymentItems || []).map(p => `
            <tr>
                <td>${p.method} ${p.bank ? `(${p.bank.name})` : ''}</td>
                <td>${p.description || '-'}</td>
                <td style="text-align:right;">₺${formatLira(p.amount)}</td>
            </tr>
        `).join('');
        html = html.replace('{{paymentDetailsHtml}}', paymentDetailsHtml);
        
        // Özet bölümünü doldur
        let discountSummaryHtml = '';
        if (totalDiscount > 0) {
            discountSummaryHtml = `
                <tr>
                    <td>Orijinal Toplam:</td>
                    <td style="text-align:right;">₺${formatLira(subTotal)}</td>
                </tr>
                <tr class="discount-total">
                    <td>Toplam İndirim:</td>
                    <td style="text-align:right;">-₺${formatLira(totalDiscount)}</td>
                </tr>
            `;
        }
        html = html.replace('{{discountSummary}}', discountSummaryHtml);
        html = html.replace('{{subTotal}}', formatLira(subTotal));
        html = html.replace('{{totalAmount}}', formatLira(order.total_amount));
        html = html.replace('{{paidAmount}}', formatLira(order.paid_amount));
        html = html.replace('{{remainingAmount}}', formatLira(order.remaining_amount));
        
        const pdfBuffer = await createPdfFromHtml(html);
        res.set({ 'Content-Type': 'application/pdf', 'Content-Length': pdfBuffer.length }).send(pdfBuffer);
    } catch (error) {
        console.error('Sipariş PDF hatası:', error);
        res.status(500).send('Sipariş PDF oluşturulamadı.');
    }
});


app.listen(port, () => {
    console.log(`PDF servisi http://localhost:${port} adresinde çalışıyor`);
});
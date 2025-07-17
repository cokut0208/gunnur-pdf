// backend/index.js
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
        const paymentMethodLabels = { cash: 'Nakit', credit_card: 'Kredi Kartı', bank_transfer: 'Havale/EFT', installment: 'Taksitli', credit: 'Kredili', swap: '2.El Takas' };

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

        // Takas aracını buluyoruz. Frontend'den gelen 'used_vehicle' objesini arıyoruz.
        const tradeInPayment = (paymentItems || []).find(p => p.payment_method === 'swap' && p.used_vehicle);
        const tradeInVehicle = tradeInPayment ? tradeInPayment.used_vehicle : null;
        
        let tradeInSectionHtml = '';
        if (tradeInVehicle) {
            // Takas aracı varsa, bu HTML bloğunu oluşturuyoruz.
            // style="grid-column: 1 / -1;" eklemesi, bu bölümün her zaman tam genişlikte yer almasını sağlar.
            tradeInSectionHtml = `
            <div class="info-box trade-in-box" style="grid-column: 1 / -1;">
                <h3>TAKAS ARAÇ BİLGİLERİ</h3>
                <p><strong>Ruhsat Sahibi:</strong> ${tradeInVehicle.owner_name || ''}</p>
                <p><strong>Plaka:</strong> ${tradeInVehicle.license_plate || ''}</p>
                <p><strong>Telefon:</strong> ${tradeInVehicle.phone_number || 'Belirtilmemiş'}</p>
            </div>
            `;
        }
        html = html.replace('{{tradeInSection}}', tradeInSectionHtml);
        
        const itemsHtml = orderItems.map(item => {
            const discountDescription = item.manual_discount_description 
                ? `(${item.manual_discount_description})`
                : item.discount_name ? `(${item.discount_name})` : '';

            const discountInfoHtml = (item.discount_amount || 0) > 0 
                ? `<br><span class="discount-text">İndirim: -₺${formatLira(item.discount_amount)} ${discountDescription}</span>`
                : '';
                
            return `
                <tr>
                    <td>
                        ${item.product_name || 'Bilinmeyen Ürün'}
                        ${discountInfoHtml}
                    </td>
                    <td>${item.color || '-'} / ${item.modelYear || '-'}</td>
                    <td style="text-align:center;">${item.quantity}</td>
                    <td style="text-align:right;">₺${formatLira(item.unit_price)}</td>
                    <td style="text-align:right;">₺${formatLira(item.total_price)}</td>
                </tr>
                <tr>
                    <td colspan="5" style="font-size: 7pt; padding-top:0; border-bottom: 1px solid #ddd;"><strong>Şasi No:</strong> ${item.chassis_number}</td>
                </tr>`;
        }).join('');
        html = html.replace('{{orderItems}}', itemsHtml);

        const paymentDetailsHtml = (paymentItems || []).map(p => `
            <tr>
                <td>${paymentMethodLabels[p.payment_method] || p.payment_method} ${p.bank ? `(${p.bank.name})` : ''}</td>
                <td>${p.description || '-'}</td>
                <td style="text-align:right;">₺${formatLira(p.amount)}</td>
            </tr>
        `).join('');
        html = html.replace('{{paymentDetailsHtml}}', paymentDetailsHtml);
        
        const subTotal = orderItems.reduce((sum, item) => sum + (item.original_price || 0) * (item.quantity || 1), 0);
        const totalDiscount = orderItems.reduce((sum, item) => sum + (item.discount_amount || 0) * (item.quantity || 1), 0);
        
        let discountSummaryHtml = '';
        if (totalDiscount > 0) {
            discountSummaryHtml = `
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

app.post('/api/generate/day-end', async (req, res) => {
    // Bu endpoint'i projenizdeki haline göre kontrol edin
});

app.listen(port, () => {
    console.log(`PDF servisi http://localhost:${port} adresinde çalışıyor`);
});
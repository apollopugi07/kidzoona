const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const { SerialPort, ReadlineParser } = require('serialport'); 

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

app.use(express.static(__dirname));

const arduinoPort = new SerialPort({
    path: '/dev/ttyACM0', 
    baudRate: 9600 
});

const parser = arduinoPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

let paymentResolver = null;
let currentPaidAmount = 0; 

parser.on('data', (data) => {
    console.log(' Arduino says:', data);
    
    if (data.includes("PAID:")) {
        const parts = data.split(':');
        if (parts.length > 1) {
            currentPaidAmount = parseInt(parts[1]); 
        }
    }

    if (data.includes("PAYMENT_COMPLETE") || data.includes("No socks ordered")) {
        if (paymentResolver) {
            paymentResolver(); 
            paymentResolver = null;
        }
    }
});

mongoose.connect('mongodb+srv://kidzoona:DBK900@cluster0.vl7q5ac.mongodb.net/kidzoona_db?appName=Cluster0', {})
  .then(() => console.log(" Connected to MongoDB"))
  .catch(err => console.error(" MongoDB Connection Error:", err));

const RegistrationSchema = new mongoose.Schema({
    registrationDate: { type: Date, default: Date.now },
    checkoutDate: { type: Date },
    ticketNumber: Number, 
    childCount: Number,
    adultCount: Number,
    children: [{ name: String, age: String, gender: String }],
    guardians: [{ name: String, phone: String }],
    playtimeRate: Number, 
    socks: { kidsQty: Number, adultsQty: Number, totalPrice: Number },
    grandTotal: String, 
    status: { type: String, default: 'active' }
});

const Registration = mongoose.model('Registration', RegistrationSchema);

app.get('/api/payment-status', (req, res) => {
    res.json({ paid: currentPaidAmount });
});

app.post('/api/register', async (req, res) => {
    try {
        console.log(" Receiving Data:", req.body); 
        currentPaidAmount = 0; 

        const lastReg = await Registration.findOne().sort({ ticketNumber: -1 });
        const nextTicket = (lastReg && lastReg.ticketNumber) ? lastReg.ticketNumber + 1 : 1;

        const playtimeFee = req.body.playtimeRate * req.body.childCount;
        const socksFee = (req.body.socks.kidsQty + req.body.socks.adultsQty) * 50;
        const totalAmount = playtimeFee + socksFee;
        const totalPulses = totalAmount / 10; 

        let command = "";
        const aQty = req.body.socks.adultsQty;
        const cQty = req.body.socks.kidsQty;

        if (aQty > 0 && cQty > 0) command = `B${aQty},${cQty}#${totalPulses}\n`;
        else if (aQty > 0) command = `A${aQty}#${totalPulses}\n`;
        else if (cQty > 0) command = `C${cQty}#${totalPulses}\n`;
        else command = `N0#${totalPulses}\n`;

        console.log(` Sending Command: ${command.trim()} (Waiting for ₱${totalAmount})`);
        arduinoPort.write(command);

        await new Promise((resolve) => {
            paymentResolver = resolve;
        });

        console.log(" Payment Confirmed! Saving...");

        const newReg = new Registration({ ...req.body, ticketNumber: nextTicket });
        const savedReg = await newReg.save();
        res.status(201).json({ success: true, id: savedReg._id, ticketNumber: nextTicket });

    } catch (error) {
        console.error(" Error:", error);
        res.status(500).json({ success: false });
    }
});

app.get('/api/admin/registrations', async (req, res) => {
    try {
        const regs = await Registration.find().sort({ registrationDate: -1 });
        res.json(regs);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

app.put('/api/admin/registrations/checkout/:id', async (req, res) => {
    try {
        await Registration.findByIdAndUpdate(req.params.id, { 
            status: 'completed',
            checkoutDate: new Date()
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to update status" });
    }
});

app.delete('/api/admin/registrations/:id', async (req, res) => {
    try {
        await Registration.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete" });
    }
});

app.listen(PORT, () => {
    console.log(` Server running on http://0.0.0.0:${PORT}`);
});
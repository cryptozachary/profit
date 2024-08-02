const mongoose = require('mongoose');

const bullBearSchema = new mongoose.Schema({
    logEntry: { type: String, required: true }
});

const BullBear = mongoose.model('BullBear', bullBearSchema);

module.exports = BullBear;

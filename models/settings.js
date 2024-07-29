const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    theme: { type: String, required: true },
    exchange: { type: String, required: true },
    refreshRate: { type: String, required: true },
    notifications: { type: Boolean, required: false },
    customIndicator: { type: String, required: false },
    language: { type: String, required: true }
});

const Settings = mongoose.model('Settings', settingsSchema);

module.exports = Settings;

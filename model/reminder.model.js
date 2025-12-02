import mongoose from "mongoose";

const reminderSchema = new mongoose.Schema({
    chatId: {
        type: Number,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    time: {
        type: Date,
        required: true
    },
}, { timestamps: true });

const Reminder = mongoose.model("Reminder", reminderSchema);

export default Reminder;

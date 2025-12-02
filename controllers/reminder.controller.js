import Reminder from "../model/reminder.model.js";

export const createReminder = async (chatId, title, time) => {
    try {
        const newReminder = new Reminder({ chatId, title, time });
        await newReminder.save();
        return newReminder;
    } catch (error) {
        console.error(error);
    }
};

export const getReminders = async () => {
    try {
        const reminders = await Reminder.find();
        return reminders;
    } catch (error) {
        console.error(error);
        res.status(500).json({ msg: "Server error" });
    }
};

export const getRemindersByChatId = async (chatId) => {
    try {
        const reminders = await Reminder.find({chatId});
        return reminders;
    } catch (error) {
        console.error(error);
        res.status(500).json({ msg: "Server error" });
    }
};


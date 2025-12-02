import { Telegraf } from "telegraf";
import OpenAI from "openai";
import dotenv from "dotenv";
import schedule from "node-schedule";
import express from "express";
import mongoose from "mongoose";
import { createReminder, getReminders, getRemindersByChatId } from "./controllers/reminder.controller.js";
import Reminder from "./model/reminder.model.js";

dotenv.config();

const app = express();
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.log(err));

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const client = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});

const TOOLS = { reminder, listReminders, deleteReminder, updateReminder, updateReminderById };

async function initializeReminders() {
    const response = await getReminders();
    for (const r of response) {
        schedule.scheduleJob(r._id.toString(), new Date(r.time), async () => {
            await bot.telegram.sendMessage(r.chatId, `⏰ Hi, this is your REMINDER: ${r.title}`);
            await Reminder.findByIdAndDelete(r._id);
        });
    }
}

initializeReminders();

async function listReminders(chatId) {
    const response = await getRemindersByChatId(chatId);

    const options = {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    };
    const lines = response.map((r, i) => {
        const time = new Date(r.time).toLocaleString("en-IN", options)
        return `${i + 1}. ${r.title} — ${time}`
    })
    return { response, lines };
}

function chunk(arr, size) {
    const rows = [];
    for (let i = 0; i < arr.length; i += size) {
        rows.push(arr.slice(i, i + size));
    }
    return rows;
}

async function deleteReminder(chatId) {
    const { lines, response } = await listReminders(chatId);
    const buttons = response.map((r, i) => (
        { text: `${i + 1}`, callback_data: `sel:${r._id}` }
    ))
    const keyboard = chunk(buttons, 2)
    return { lines, keyboard, response }
}

async function updateReminder(chatId) {
    const { lines, response } = await listReminders(chatId);
    const buttons = response.map((r, i) => (
        { text: `${i + 1}`, callback_data: `upd:${r._id}` }
    ))
    const keyboard = chunk(buttons, 2)
    return { lines, response, keyboard }
}

async function updateReminderById(id, params) {
    try {
        const job = schedule.scheduledJobs[id];
        if (job) job.cancel();

        const res = await Reminder.findByIdAndUpdate(id, { $set: params }, { new: true });
        reminder(res._id, res.title, res.time, res.chatId);

        return { success: true, message: "Reminder updated successfully" };
    } catch (err) {
        return { success: false, error: "Failed to update reminder" };
    }
}


function reminder(reminderId, reminderTitle, reminderTime, chatId,) {
    schedule.scheduleJob(reminderId.toString(), new Date(reminderTime), async () => {
        await bot.telegram.sendMessage(chatId, `⏰ Hi, this is your REMINDER: ${reminderTitle}`);
        await Reminder.deleteOne({ _id: reminderId });
    });
    return;
}

let messages = [];

bot.start((ctx) => ctx.reply(`Hello ${ctx.from.first_name}! I am RemindMeBot.
I can help you manage your reminders.
You can create, view, update, and delete reminders easily.
`));

bot.on("text", async (ctx) => {
    try {
        const userMessage = ctx.message.text;
        const username = ctx.from.first_name

        const systemPrompt = `
        You are RemindMeBot — an intelligent reminder assistant for Telegram developed by Roy. 
        Your job is to help the user create, view, update, and delete reminders.

        CONTEXT:
        - USER NAME: ${username}
        - CHAT ID: ${ctx.chat.id}
        - CURRENT TIME: ${new Date().toString()}

        CORE BEHAVIOR RULES

        1) TOOL USAGE RULES
        Use tools ONLY when you have enough information to perform the action.

        • Use reminder(...) ONLY when BOTH a clear title AND a specific time are provided.  
        Examples of valid triggers:
            - "remind me to drink water at 5pm"
            - "set a reminder tomorrow at 10am to call mom"

        • Use listReminders(chatId) when user asks:
            - "show my reminders"
            - "list my reminders"
            - "what reminders do I have?"

        • Use deleteReminder(chatId) when user wants to delete a reminder.
            (This tool only SHOWS selectable reminders — deletion happens through callback buttons.)

        • Use updateReminder(chatId) when user wants to modify a reminder.
            (Actual editing is handled using updateReminderById after user provides new data.)

        • Use updateReminderById(id, params) when:
            - You already know which reminder is selected (from system message or callback)
            - And user has provided new title/time/both.

        Unless all required parameters are present, DO NOT call this tool.

        2) WHEN NOT TO USE TOOLS (respond with normal text)

        Respond normally when:
        - User greeting ("hi", "hello", etc.)
        - User asks general questions
        - User gives incomplete reminder info
        (missing title or missing time)
        - User types anything NOT related to reminders

        EXAMPLES:
        User: "remind me to call mom"
        → Ask: "What time should I remind you?"

        User: "set at 5pm"
        → Ask: "What should I remind you about at 5pm?"

        3) DATE / TIME HANDLING

        Always convert parsed times into a node-schedule compatible ISO string:
            "2025-11-19T14:00:00"
        If user gives natural language time ("tomorrow morning", "in 2 hours"),
        interpret it using CURRENT TIME context.

        4) YOUR MAIN GOAL
        • Understand user intent clearly  
        • Ask clarifying questions ONLY when required  
        • Trigger tools ONLY when you have all required info  
        • Keep answers short, friendly, and helpful  

        5) ONGOING UPDATE/DELETE FLOWS
        If you previously received an instruction from the assistant (e.g., 
        “here users shares you new title...”), then the user's next message MUST be interpreted 
        as reminder update input, even if it looks like general conversation.
        Do NOT fall back to general chat until the update/delete flow is complete.

        6) STRICT NON-REMINDER BEHAVIOR
        For any non-reminder queries, respond politely that you only handle reminders.
        Always avoid using tools for non-reminder queries.
        Remember, your primary function is REMINDER MANAGEMENT.
        Always follow these rules strictly!

        7) SMART TITLE INTERPRETATION (IMPORTANT)

        If the user sends a message that looks like a task/action (e.g., 
        "buy soap", "go gym", "drink water", "pay bills", "call mom", 
        "finish homework", "take medicine", "wake up early") but does NOT include a time:

        → Treat the message as a REMINDER TITLE.
        → Do NOT reject it.
        → Ask the user: "What time should I remind you?"

        ONLY use this logic if:
        • The message is not a question, AND
        • The message is not unrelated general chat, AND
        • The message clearly represents a task or action.

        Examples:
        User: "buy soap"
        → "Sure — what time should I remind you to buy soap?"

        User: "drink water"
        → "What time should I remind you to drink water?"

        User: "go gym tonight"
        → If time is included (tonight), interpret it and schedule directly.

        This feature greatly improves reminder creation flow.

        `;

        messages.push({ role: "system", content: systemPrompt });
        messages.push({ role: "user", content: userMessage });

        let response = await client.chat.completions.create({
            model: "gemini-2.5-flash",

            messages,
            tools: [
                {
                    type: "function",
                    function: {
                        name: "reminder",
                        description: "Schedule one or multiple reminders for the user.",
                        parameters: {
                            type: "object",
                            properties: {
                                reminders: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            title: { type: "string", description: "Title of the reminder" },
                                            time: { type: "string", description: "node schedule compatible date string" }
                                        },
                                        required: ["title", "time"]
                                    }
                                },
                                message: { type: "string", description: "Message to the user" }
                            },
                            required: ["reminders", "message"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "listReminders",
                        description: "List all pending reminders for the user.",
                        parameters: {
                            type: "object",
                            properties: {
                                chatId: { type: "number", description: "The chat ID of the user" }
                            },
                            required: ["chatId"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "deleteReminder",
                        description: "Delete the selected reminder",
                        parameters: {
                            type: "object",
                            properties: {
                                chatId: { type: "number", description: "The chat ID of the user" }
                            },
                            required: ["chatId"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "updateReminder",
                        description: "Update the selected reminder",
                        parameters: {
                            type: "object",
                            properties: {
                                chatId: { type: "number", description: "The chat ID of the user" }
                            },
                            required: ["chatId"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "updateReminderById",
                        description: "Update the selected reminder by id",
                        parameters: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "string",
                                    description: "The ID of the reminder to update"
                                },
                                params: {
                                    type: "object",
                                    description: "Fields to update (provide one or both)",
                                    properties: {
                                        title: { type: "string", description: "New title for the reminder" },
                                        time: { type: "string", description: "New time (node-schedule/ISO string)" }
                                    },
                                    additionalProperties: false
                                }
                            },
                            required: ["id"]
                        }
                    }
                }

            ],
            tool_choice: "auto"

        });

        const botReply = response.choices[0].message;
        if (botReply.tool_calls) {
            for (const toolCall of botReply.tool_calls) {
                const toolName = toolCall.function.name;
                const fn = TOOLS[toolName];
                const args = JSON.parse(toolCall.function.arguments);

                if (toolName === "reminder") {
                    for (const r of args.reminders) {
                        const res = await createReminder(ctx.chat.id, r.title, r.time);
                        if (res) await fn(res._id, r.title, r.time, ctx.chat.id);
                    }
                    await ctx.reply(args.message);
                }

                if (toolName === "listReminders") {
                    const { response, lines } = await fn(args.chatId)
                    if (response.length === 0) await ctx.reply("You have no reminders!")
                    else await ctx.reply(`Your reminders:\n\n${lines.join('\n')}`)
                }

                if (toolName === "deleteReminder") {
                    const { lines, keyboard, response } = await fn(args.chatId)
                    if (response.length === 0) await ctx.reply("You have no reminders to delete!")
                    else await ctx.reply(lines.join('\n'), {
                        reply_markup: { inline_keyboard: keyboard }
                    });
                }

                if (toolName === "updateReminder") {
                    const { lines, keyboard, response } = await fn(args.chatId)
                    if (response.length === 0) await ctx.reply("You have no reminders to update!")
                    else await ctx.reply(lines.join('\n'), {
                        reply_markup: { inline_keyboard: keyboard }
                    });
                }

                if (toolName === "updateReminderById") {
                    const res = await fn(args.id, args.params);
                    if (res.success) await ctx.reply(res.message);
                    else await ctx.reply(res.error);
                }

                messages = [
                    { role: "system", content: systemPrompt }
                ];
            }
        } else {
            await ctx.reply(botReply.content);
        }


    } catch (err) {
        console.error(err);
        ctx.reply("Something went wrong!");
    }
});

bot.on("callback_query", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const id = data.split(":")[1];

    if (data.startsWith("sel:")) {

        await ctx.editMessageText("Are you sure you want to delete this reminder?", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Yes, delete", callback_data: `del_confirm:${id}` }],
                    [{ text: "Cancel", callback_data: `del_cancel:${id}` }]
                ]
            }
        });

        await ctx.answerCbQuery();

    }

    if (data.startsWith("del_confirm:")) {

        const job = schedule.scheduledJobs[id];
        if (job) job.cancel();

        await Reminder.findByIdAndDelete(id);

        await ctx.editMessageText("✅ Reminder deleted successfully!");
        await ctx.answerCbQuery("Deleted");
    }

    if (data.startsWith("del_cancel:")) {
        await ctx.editMessageText("❌ Deletion cancelled.");
        await ctx.answerCbQuery("Cancelled");
    }

    if (data.startsWith("upd:")) {
        await ctx.editMessageText("What do you want to update?", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Title", callback_data: `upd_title:${id}` }],
                    [{ text: "Time", callback_data: `upd_time:${id}` }],
                    [{ text: "Title + Time", callback_data: `upd_both:${id}` }],
                    [{ text: "Cancel", callback_data: "upd_cancel" }]
                ]
            }
        });

        await ctx.answerCbQuery();
    }

    if (data.startsWith("upd_title:")) {
        await ctx.editMessageText("Okay! What is the new title?");
        messages.push({ role: "assistant", content: `here users shares you new title to update and this is an id to update title ${id} and here no need to ask time and use updateReminderById tool to update title only` });
    }
    if (data.startsWith("upd_time:")) {
        await ctx.editMessageText("Okay! What is the new time?");
        messages.push({ role: "assistant", content: `here users shares you new time to update and this is an id to update time ${id} and here no need to ask title and use updateReminderById tool to update time only` });
    }
    if (data.startsWith("upd_both:")) {
        await ctx.editMessageText("Okay! Tell me the new title and time.");
        messages.push({ role: "assistant", content: `here users shares you both title and time to update and this is an id to update both title and time ${id} and use updateReminderById tool to update both title and time` });
    }
    if (data.startsWith("upd_cancel:")) {
        await ctx.editMessageText("❌ Updating cancelled.");
        await ctx.answerCbQuery("Cancelled");
    }
})

bot.launch();
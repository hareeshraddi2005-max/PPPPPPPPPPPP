const { Telegraf, Markup, session } = require("telegraf");
const fs = require("fs");
const path = require("path");

// ─── Config ───────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const DB_PATH = path.join(__dirname, "games.json");

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is not set in environment variables.");
if (!ADMIN_ID) throw new Error("ADMIN_ID is not set in environment variables.");

// ─── Database Helpers ─────────────────────────────────────────────────────────
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { games: [], orders: [] };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Bot Setup ────────────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

// In-memory session store (no external dependency)
const sessions = {};
bot.use((ctx, next) => {
  const id = ctx.from?.id;
  if (!id) return next();
  if (!sessions[id]) sessions[id] = {};
  ctx.session = sessions[id];
  return next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isAdmin = (ctx) => ctx.from?.id === ADMIN_ID;

const GAME_TYPES = ["Online", "Offline", "Both"];

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🎮 Online Games", "type_Online")],
    [Markup.button.callback("🕹️ Offline Games", "type_Offline")],
    [Markup.button.callback("🌐 Online & Offline", "type_Both")],
  ]);
}

function adminMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("➕ Add Game", "admin_add")],
    [Markup.button.callback("🗑️ Delete Game", "admin_delete")],
    [Markup.button.callback("📦 Update Stock", "admin_stock")],
    [Markup.button.callback("📋 View Orders", "admin_orders")],
  ]);
}

function gameListKeyboard(games) {
  const buttons = games.map((g) => [
    Markup.button.callback(
      `${g.name} — $${g.price} ${g.stock === 0 ? "❌" : "✅"}`,
      `game_${g.id}`
    ),
  ]);
  buttons.push([Markup.button.callback("🔙 Back", "back_main")]);
  return Markup.inlineKeyboard(buttons);
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.start((ctx) => {
  ctx.session = {}; // reset session on /start
  ctx.reply(
    `👋 Welcome to the *Game Store*!\n\nChoose a category:`,
    { parse_mode: "Markdown", ...mainMenu() }
  );
});

// ─── Admin Panel ──────────────────────────────────────────────────────────────
bot.command("admin", (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("⛔ Access denied.");
  ctx.session = {};
  ctx.reply("👑 *Admin Panel*", { parse_mode: "Markdown", ...adminMenu() });
});

// ─── Browse by Type ───────────────────────────────────────────────────────────
bot.action(/^type_(.+)$/, (ctx) => {
  const type = ctx.match[1];
  const db = readDB();
  const games = db.games.filter((g) => g.type === type);
  ctx.answerCbQuery();
  if (!games.length)
    return ctx.editMessageText(`No *${type}* games available yet.`, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "back_main")]]),
    });
  ctx.editMessageText(`*${type} Games:*`, {
    parse_mode: "Markdown",
    ...gameListKeyboard(games),
  });
});

// ─── Game Detail ──────────────────────────────────────────────────────────────
bot.action(/^game_(.+)$/, (ctx) => {
  const id = ctx.match[1];
  const db = readDB();
  const game = db.games.find((g) => g.id === id);
  ctx.answerCbQuery();
  if (!game) return ctx.editMessageText("Game not found.");

  const stockText = game.stock > 0 ? `✅ In Stock (${game.stock})` : "❌ Out of Stock";
  const text =
    `🎮 *${game.name}*\n` +
    `💰 Price: $${game.price}\n` +
    `📦 Stock: ${stockText}\n` +
    `🏷️ Type: ${game.type}\n\n` +
    `📝 ${game.description}`;

  const buttons = [[Markup.button.callback("🔙 Back", `type_${game.type}`)]];
  if (game.stock > 0)
    buttons.unshift([Markup.button.callback("🛒 Buy Now", `buy_${game.id}`)]);

  ctx.editMessageText(text, { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) });
});

// ─── Buy ──────────────────────────────────────────────────────────────────────
bot.action(/^buy_(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  const db = readDB();
  const game = db.games.find((g) => g.id === id);
  ctx.answerCbQuery();

  if (!game) return ctx.reply("Game not found.");
  if (game.stock === 0) return ctx.reply("❌ This game is out of stock.");

  // Decrease stock
  game.stock -= 1;

  // Save order
  const order = {
    orderId: generateId(),
    userId: ctx.from.id,
    username: ctx.from.username || ctx.from.first_name,
    gameId: game.id,
    gameName: game.name,
    price: game.price,
    date: new Date().toISOString(),
  };
  db.orders.push(order);
  writeDB(db);

  // Notify admin
  await bot.telegram.sendMessage(
    ADMIN_ID,
    `🛒 *New Order!*\n\n` +
      `👤 User: @${order.username} (ID: ${order.userId})\n` +
      `🎮 Game: ${order.gameName}\n` +
      `💰 Price: $${order.price}\n` +
      `🆔 Order ID: ${order.orderId}`,
    { parse_mode: "Markdown" }
  );

  // Confirm to user
  ctx.editMessageText(
    `✅ *Order Placed!*\n\n` +
      `🎮 Game: ${game.name}\n` +
      `💰 Price: $${game.price}\n` +
      `🆔 Order ID: ${order.orderId}\n\n` +
      `The admin will contact you shortly.`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Main Menu", "back_main")]]),
    }
  );
});

// ─── Back to Main ─────────────────────────────────────────────────────────────
bot.action("back_main", (ctx) => {
  ctx.answerCbQuery();
  ctx.editMessageText("👋 Welcome to the *Game Store*!\n\nChoose a category:", {
    parse_mode: "Markdown",
    ...mainMenu(),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Add Game (step-by-step via session) ──────────────────────────────────────
bot.action("admin_add", (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("⛔ Access denied.");
  ctx.answerCbQuery();
  ctx.session.step = "add_name";
  ctx.session.newGame = {};
  ctx.reply("📝 Enter the *game name*:", { parse_mode: "Markdown" });
});

// ─── Delete Game ──────────────────────────────────────────────────────────────
bot.action("admin_delete", (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("⛔ Access denied.");
  ctx.answerCbQuery();
  const db = readDB();
  if (!db.games.length) return ctx.reply("No games to delete.");
  const buttons = db.games.map((g) => [
    Markup.button.callback(`🗑️ ${g.name}`, `del_${g.id}`),
  ]);
  buttons.push([Markup.button.callback("🔙 Back", "back_admin")]);
  ctx.reply("Select a game to delete:", Markup.inlineKeyboard(buttons));
});

bot.action(/^del_(.+)$/, (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("⛔ Access denied.");
  const id = ctx.match[1];
  const db = readDB();
  const idx = db.games.findIndex((g) => g.id === id);
  ctx.answerCbQuery();
  if (idx === -1) return ctx.editMessageText("Game not found.");
  const name = db.games[idx].name;
  db.games.splice(idx, 1);
  writeDB(db);
  ctx.editMessageText(`✅ *${name}* has been deleted.`, { parse_mode: "Markdown" });
});

// ─── Update Stock ─────────────────────────────────────────────────────────────
bot.action("admin_stock", (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("⛔ Access denied.");
  ctx.answerCbQuery();
  const db = readDB();
  if (!db.games.length) return ctx.reply("No games available.");
  const buttons = db.games.map((g) => [
    Markup.button.callback(`📦 ${g.name} (Stock: ${g.stock})`, `stock_${g.id}`),
  ]);
  buttons.push([Markup.button.callback("🔙 Back", "back_admin")]);
  ctx.reply("Select a game to update stock:", Markup.inlineKeyboard(buttons));
});

bot.action(/^stock_(.+)$/, (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("⛔ Access denied.");
  ctx.answerCbQuery();
  ctx.session.step = "update_stock";
  ctx.session.stockGameId = ctx.match[1];
  ctx.reply("Enter the *new stock amount*:", { parse_mode: "Markdown" });
});

// ─── View Orders ──────────────────────────────────────────────────────────────
bot.action("admin_orders", (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("⛔ Access denied.");
  ctx.answerCbQuery();
  const db = readDB();
  if (!db.orders.length) return ctx.reply("No orders yet.");

  // Show last 20 orders to avoid message length limit
  const recent = db.orders.slice(-20).reverse();
  const text = recent
    .map(
      (o, i) =>
        `*${i + 1}.* 🎮 ${o.gameName} — $${o.price}\n` +
        `   👤 @${o.username} (${o.userId})\n` +
        `   🆔 ${o.orderId}`
    )
    .join("\n\n");

  ctx.reply(`📋 *Recent Orders (last ${recent.length}):*\n\n${text}`, {
    parse_mode: "Markdown",
  });
});

// ─── Back to Admin ────────────────────────────────────────────────────────────
bot.action("back_admin", (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("⛔ Access denied.");
  ctx.answerCbQuery();
  ctx.session = {};
  ctx.editMessageText("👑 *Admin Panel*", { parse_mode: "Markdown", ...adminMenu() });
});

// ─── Text Message Handler (session steps) ────────────────────────────────────
bot.on("text", async (ctx) => {
  const step = ctx.session?.step;
  const text = ctx.message.text.trim();

  // ── Add Game Steps ──
  if (step === "add_name") {
    ctx.session.newGame.name = text;
    ctx.session.step = "add_price";
    return ctx.reply("💰 Enter the *price* (numbers only):", { parse_mode: "Markdown" });
  }

  if (step === "add_price") {
    const price = parseFloat(text);
    if (isNaN(price) || price < 0) return ctx.reply("❌ Invalid price. Enter a valid number:");
    ctx.session.newGame.price = price;
    ctx.session.step = "add_stock";
    return ctx.reply("📦 Enter the *stock amount*:", { parse_mode: "Markdown" });
  }

  if (step === "add_stock") {
    const stock = parseInt(text);
    if (isNaN(stock) || stock < 0) return ctx.reply("❌ Invalid stock. Enter a valid number:");
    ctx.session.newGame.stock = stock;
    ctx.session.step = "add_description";
    return ctx.reply("📝 Enter the *description*:", { parse_mode: "Markdown" });
  }

  if (step === "add_description") {
    ctx.session.newGame.description = text;
    ctx.session.step = "add_type";
    return ctx.reply(
      "🏷️ Select the *game type*:",
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard(
          GAME_TYPES.map((t) => [Markup.button.callback(t, `settype_${t}`)])
        ),
      }
    );
  }

  // ── Update Stock Step ──
  if (step === "update_stock") {
    const stock = parseInt(text);
    if (isNaN(stock) || stock < 0) return ctx.reply("❌ Invalid number. Try again:");
    const db = readDB();
    const game = db.games.find((g) => g.id === ctx.session.stockGameId);
    if (!game) return ctx.reply("Game not found.");
    game.stock = stock;
    writeDB(db);
    ctx.session.step = null;
    return ctx.reply(`✅ Stock for *${game.name}* updated to *${stock}*.`, {
      parse_mode: "Markdown",
    });
  }
});

// ─── Set Game Type (final add step) ──────────────────────────────────────────
bot.action(/^settype_(.+)$/, (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("⛔ Access denied.");
  ctx.answerCbQuery();
  const type = ctx.match[1];
  if (!GAME_TYPES.includes(type)) return ctx.reply("Invalid type.");

  const game = ctx.session.newGame;
  if (!game?.name) return ctx.reply("Session expired. Use /admin to start again.");

  const db = readDB();
  db.games.push({ id: generateId(), ...game, type });
  writeDB(db);
  ctx.session = {};

  ctx.editMessageText(
    `✅ *${game.name}* added!\n\n` +
      `💰 Price: $${game.price}\n` +
      `📦 Stock: ${game.stock}\n` +
      `🏷️ Type: ${type}`,
    { parse_mode: "Markdown" }
  );
});

// ─── Error Handler ────────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err.message);
  ctx.reply("⚠️ Something went wrong. Please try again.").catch(() => {});
});

// ─── Launch ───────────────────────────────────────────────────────────────────
bot.launch().then(() => console.log("✅ Bot is running..."));

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

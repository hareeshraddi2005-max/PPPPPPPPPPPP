const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");

// ─── CONFIG ─────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID); // ✅ FIXED

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");
if (!ADMIN_ID) throw new Error("ADMIN_ID missing");

const bot = new Telegraf(BOT_TOKEN);
const DB_PATH = path.join(__dirname, "games.json");

// ─── DB ─────────────────────────────────────────────
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
  return Date.now().toString();
}

// ─── SESSION ────────────────────────────────────────
const sessions = {};

function getSession(id) {
  if (!sessions[id]) sessions[id] = {};
  return sessions[id];
}

function clearSession(id) {
  sessions[id] = {};
}

// ─── ADMIN CHECK (SUPER SAFE) ───────────────────────
function isAdmin(ctx) {
  return String(ctx.from?.id) === String(ADMIN_ID);
}

// ─── START ──────────────────────────────────────────
bot.start((ctx) => {
  clearSession(ctx.from.id);

  if (isAdmin(ctx)) {
    return ctx.reply(
      "👑 Admin Panel\n\n/addgame\n/deletegame\n/updatestock\n/orders\n/listgames\n\nUse /browse"
    );
  }

  ctx.reply("🎮 Choose game type:", {
    ...Markup.inlineKeyboard([
      [Markup.button.callback("Online", "type_Online")],
      [Markup.button.callback("Offline", "type_Offline")],
      [Markup.button.callback("Both", "type_Both")],
    ]),
  });
});

// ─── BROWSE ─────────────────────────────────────────
bot.command("browse", (ctx) => {
  ctx.reply("🎮 Choose game type:", {
    ...Markup.inlineKeyboard([
      [Markup.button.callback("Online", "type_Online")],
      [Markup.button.callback("Offline", "type_Offline")],
      [Markup.button.callback("Both", "type_Both")],
    ]),
  });
});

// ─── TYPE ───────────────────────────────────────────
bot.action(/^type_(.+)$/, (ctx) => {
  const type = ctx.match[1];
  const db = readDB();

  const games = db.games.filter(
    (g) => g.type === type || g.type === "Both" || type === "Both"
  );

  if (!games.length) return ctx.editMessageText("No games found");

  const buttons = games.map((g) => [
    Markup.button.callback(`${g.name} ₹${g.price}`, `game_${g.id}`),
  ]);

  buttons.push([Markup.button.callback("🔙 Back", "back")]);

  ctx.editMessageText("Select game:", {
    ...Markup.inlineKeyboard(buttons),
  });
});

// ─── BACK ───────────────────────────────────────────
bot.action("back", (ctx) => {
  ctx.editMessageText("🎮 Choose game type:", {
    ...Markup.inlineKeyboard([
      [Markup.button.callback("Online", "type_Online")],
      [Markup.button.callback("Offline", "type_Offline")],
      [Markup.button.callback("Both", "type_Both")],
    ]),
  });
});

// ─── GAME VIEW ──────────────────────────────────────
bot.action(/^game_(.+)/, (ctx) => {
  const db = readDB();
  const game = db.games.find((g) => g.id === ctx.match[1]);
  if (!game) return;

  ctx.reply(
    `🎮 ${game.name}\n₹${game.price}\nStock: ${game.stock}\n${game.description}`,
    {
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Buy", `buy_${game.id}`)],
      ]),
    }
  );
});

// ─── BUY ────────────────────────────────────────────
bot.action(/^buy_(.+)/, async (ctx) => {
  const db = readDB();
  const game = db.games.find((g) => g.id === ctx.match[1]);
  if (!game || game.stock <= 0) return;

  game.stock -= 1;

  const user = ctx.from;

  const order = {
    id: generateId(),
    user: user.id,
    name: user.username || user.first_name,
    game: game.name,
    price: game.price,
  };

  db.orders.push(order);
  writeDB(db);

  await bot.telegram.sendMessage(
    ADMIN_ID,
    `🛒 New Order\nUser: ${order.name}\nGame: ${order.game}\n₹${order.price}`
  );

  ctx.reply("✅ Order sent to admin");
});

// ─── ADD GAME ───────────────────────────────────────
bot.command("addgame", (ctx) => {
  if (!isAdmin(ctx)) return;
  const s = getSession(ctx.from.id);
  s.step = "name";
  ctx.reply("Enter game name:");
});

// ─── TEXT HANDLER ───────────────────────────────────
bot.on("text", (ctx) => {
  const s = getSession(ctx.from.id);

  if (s.step === "name") {
    s.game = { name: ctx.message.text };
    s.step = "price";
    return ctx.reply("Enter price:");
  }

  if (s.step === "price") {
    s.game.price = ctx.message.text;
    s.step = "stock";
    return ctx.reply("Enter stock:");
  }

  if (s.step === "stock") {
    s.game.stock = parseInt(ctx.message.text);
    s.step = "desc";
    return ctx.reply("Enter description:");
  }

  if (s.step === "desc") {
    s.game.description = ctx.message.text;
    s.step = "type";
    return ctx.reply("Select type:", {
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Online", "new_Online")],
        [Markup.button.callback("Offline", "new_Offline")],
        [Markup.button.callback("Both", "new_Both")],
      ]),
    });
  }

  if (s.step === "update_stock") {
    const db = readDB();
    const game = db.games.find((g) => g.id === s.gameId);
    if (!game) return;

    game.stock = parseInt(ctx.message.text);
    writeDB(db);
    clearSession(ctx.from.id);

    return ctx.reply("✅ Stock updated");
  }
});

// ─── FINAL ADD ──────────────────────────────────────
bot.action(/^new_(.+)/, (ctx) => {
  if (!isAdmin(ctx)) return;

  const s = getSession(ctx.from.id);
  const db = readDB();

  s.game.type = ctx.match[1];
  s.game.id = generateId();

  db.games.push(s.game);
  writeDB(db);

  clearSession(ctx.from.id);

  ctx.reply(`✅ Added: ${s.game.name}`);
});

// ─── START BOT ──────────────────────────────────────
bot.launch();
console.log("🚀 Bot running...");

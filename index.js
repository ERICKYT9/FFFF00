
require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");

// CONFIGURATION
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const YELLOW = 0xFFFF00;
const PORT = process.env.PORT || 3000;

// DATABASE
const DB_FILE = path.join(__dirname, "data.json");

let db = { users: {}, settings: {} };

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    db.users ||= {};
    db.settings ||= {};
  } catch (error) {
    console.error("Database error:", error);
    process.exit(1);
  }
}

function save() {
  const temp = DB_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DB_FILE);
}

function getUser(guildId, userId) {
  const key = `${guildId}:${userId}`;

  if (!db.users[key]) {
    db.users[key] = {
      coins: 100,
      xp: 0,
      messages: 0,
      lastDaily: 0,
      lastWork: 0,
      lastXP: 0
    };
  }

  return db.users[key];
}

function getSettings(guildId) {
  db.settings[guildId] ||= {
    welcomeChannel: null,
    funChannel: null
  };

  return db.settings[guildId];
}

function makeEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(YELLOW)
    .setTitle(`💛 ${title}`)
    .setDescription(description)
    .setTimestamp();
}

// HTTP HEALTH SERVER FOR RENDER + UPTIMEROBOT
const server = http.createServer((req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      status: "ok",
      bot: client.isReady() ? "online" : "starting"
    }));
  }

  if (req.url === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("#FFFF00 is alive! 💛");
  }

  res.writeHead(404);
  res.end("Not found");
});

// DISCORD CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

// SLASH COMMANDS
const commands = [

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("See all bot commands"),

  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check your wallet"),

  new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily coins"),

  new SlashCommandBuilder()
    .setName("work")
    .setDescription("Earn coins by working"),

  new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Pay another member")
    .addUserOption(o => o.setName("user")
      .setDescription("Who to pay").setRequired(true))
    .addIntegerOption(o => o.setName("amount")
      .setDescription("Number of coins").setMinValue(1).setRequired(true)),

  new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Bet on a coin flip")
    .addStringOption(o => o.setName("choice")
      .setDescription("Heads or tails").setRequired(true)
      .addChoices(
        { name: "Heads", value: "heads" },
        { name: "Tails", value: "tails" }
      ))
    .addIntegerOption(o => o.setName("bet")
      .setDescription("Your bet").setMinValue(1).setMaxValue(10000).setRequired(true)),

  new SlashCommandBuilder()
    .setName("rps")
    .setDescription("Play rock paper scissors")
    .addStringOption(o => o.setName("choice")
      .setDescription("Your choice").setRequired(true)
      .addChoices(
        { name: "Rock", value: "rock" },
        { name: "Paper", value: "paper" },
        { name: "Scissors", value: "scissors" }
      )),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("See the richest server members"),

  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Check your XP and level"),

  new SlashCommandBuilder()
    .setName("joke")
    .setDescription("Get a random joke"),

  new SlashCommandBuilder()
    .setName("meme")
    .setDescription("Get a random meme"),

  new SlashCommandBuilder()
    .setName("roast")
    .setDescription("Give someone a friendly roast")
    .addUserOption(o => o.setName("user")
      .setDescription("Who to roast").setRequired(true)),

  new SlashCommandBuilder()
    .setName("setwelcome")
    .setDescription("Configure the welcome channel")
    .addChannelOption(o => o.setName("channel")
      .setDescription("Welcome channel").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("setfun")
    .setDescription("Configure the random message channel")
    .addChannelOption(o => o.setName("channel")
      .setDescription("Fun channel").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a server member")
    .addUserOption(o => o.setName("user")
      .setDescription("Member to kick").setRequired(true))
    .addStringOption(o => o.setName("reason")
      .setDescription("Reason for kick"))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a server member")
    .addUserOption(o => o.setName("user")
      .setDescription("Member to ban").setRequired(true))
    .addStringOption(o => o.setName("reason")
      .setDescription("Reason for ban"))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member")
    .addUserOption(o => o.setName("user")
      .setDescription("Member").setRequired(true))
    .addIntegerOption(o => o.setName("minutes")
      .setDescription("Minutes").setMinValue(1)
      .setMaxValue(40320).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Delete recent messages")
    .addIntegerOption(o => o.setName("amount")
      .setDescription("Messages to delete")
      .setMinValue(1).setMaxValue(100).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)

].map(command => command.toJSON());

// REGISTER COMMANDS
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Discord commands registered!");
}

// STARTUP
client.once("ready", () => {
  console.log(`${client.user.tag} is online!`);

  client.user.setPresence({
    activities: [{ name: "causing chaos 💛" }],
    status: "online"
  });

  // RANDOM MESSAGES EVERY 30 MINUTES
  setInterval(async () => {
    for (const [guildId, settings] of Object.entries(db.settings)) {
      if (!settings.funChannel) continue;

      const channel = await client.channels
        .fetch(settings.funChannel).catch(() => null);

      if (!channel || !channel.isTextBased()) continue;

      const messages = [
        "🚨 CHAOS DETECTED. EVERYONE PANIC.",
        "WHO ATE THE LAST COOKIE 😭",
        "Please remember to hydrate. Your brain needs it.",
        "I have absolutely no idea what I'm doing.",
        "The council demands more coins.",
        "BREAKING NEWS: Nobody here is normal.",
        "💛 Yellow supremacy."
      ];

      const message = messages[Math.floor(Math.random() * messages.length)];
      channel.send(message).catch(console.error);
    }
  }, 30 * 60 * 1000);
});

// WELCOME SYSTEM
client.on("guildMemberAdd", async member => {
  const settings = getSettings(member.guild.id);
  if (!settings.welcomeChannel) return;

  const channel = await member.guild.channels
    .fetch(settings.welcomeChannel).catch(() => null);

  if (!channel || !channel.isTextBased()) return;

  channel.send({
    embeds: [
      makeEmbed(
        "NEW HUMAN DETECTED",
        `Welcome ${member} to **${member.guild.name}**!\n\n` +
        "Behave yourself. Actually, never mind. 💛"
      )
    ]
  }).catch(console.error);
});

// XP SYSTEM
client.on("messageCreate", message => {
  if (!message.guild || message.author.bot) return;

  const data = getUser(message.guild.id, message.author.id);
  const now = Date.now();

  data.messages++;

  // One XP reward every 60 seconds
  if (now - data.lastXP >= 60000) {
    data.xp += Math.floor(Math.random() * 11) + 5;
    data.lastXP = now;
  }

  save();
});

// COMMAND HANDLER
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild, user } = interaction;

  if (!guild) {
    return interaction.reply({
      content: "Use me inside a server!",
      ephemeral: true
    });
  }

  const data = getUser(guild.id, user.id);
  const settings = getSettings(guild.id);

  try {

    // HELP
    if (commandName === "help") {
      return interaction.reply({
        embeds: [
          makeEmbed("COMMAND CENTRE",
            "**ECONOMY**\n`/balance` `/daily` `/work` `/pay`\n\n" +
            "**GAMES**\n`/coinflip` `/rps`\n\n" +
            "**SERVER**\n`/leaderboard` `/rank`\n\n" +
            "**FUN**\n`/joke` `/meme` `/roast`\n\n" +
            "**ADMIN**\n`/setwelcome` `/setfun` `/kick` `/ban` `/timeout` `/clear`")
        ]
      });
    }

    // BALANCE
    if (commandName === "balance") {
      return interaction.reply({
        embeds: [
          makeEmbed("YOUR WALLET",
            `💰 **${data.coins.toLocaleString()} coins**`)
        ]
      });
    }

    // DAILY
    if (commandName === "daily") {
      const now = Date.now();
      const remaining = 86400000 - (now - data.lastDaily);

      if (remaining > 0) {
        const hours = Math.ceil(remaining / 3600000);
        return interaction.reply({
          content: `⏰ You can claim again in ${hours} hours.`,
          ephemeral: true
        });
      }

      const reward = Math.floor(Math.random() * 101) + 100;
      data.coins += reward;
      data.lastDaily = now;
      save();

      return interaction.reply({
        embeds: [
          makeEmbed("DAILY REWARD",
            `You received **${reward} coins**! 💛`)
        ]
      });
    }

    // WORK
    if (commandName === "work") {
      const now = Date.now();

      if (now - data.lastWork < 60000) {
        return interaction.reply({
          content: "Take a break! You can work again in a minute.",
          ephemeral: true
        });
      }

      const jobs = [
        "You babysat 17 angry chickens.",
        "You inspected grass professionally.",
        "You sold invisible sandwiches.",
        "You worked in the chaos department.",
        "You cleaned a dinosaur's bedroom."
      ];

      const reward = Math.floor(Math.random() * 101) + 25;
      const job = jobs[Math.floor(Math.random() * jobs.length)];

      data.coins += reward;
      data.lastWork = now;
      save();

      return interaction.reply({
        embeds: [
          makeEmbed("WORK COMPLETE",
            `${job}\n\nYou earned **${reward} coins**!`)
        ]
      });
    }

    // PAY
    if (commandName === "pay") {
      const target = interaction.options.getUser("user");
      const amount = interaction.options.getInteger("amount");

      if (target.bot || target.id === user.id) {
        return interaction.reply({
          content: "You can't pay yourself or a bot.",
          ephemeral: true
        });
      }

      if (data.coins < amount) {
        return interaction.reply({
          content: "You're too broke for that transaction. 😭",
          ephemeral: true
        });
      }

      data.coins -= amount;
      getUser(guild.id, target.id).coins += amount;
      save();

      return interaction.reply(`💸 You paid ${target} **${amount} coins**!`);
    }

    // COINFLIP
    if (commandName === "coinflip") {
      const choice = interaction.options.getString("choice");
      const bet = interaction.options.getInteger("bet");

      if (data.coins < bet) {
        return interaction.reply({
          content: "You don't have enough coins!",
          ephemeral: true
        });
      }

      const result = Math.random() < 0.5 ? "heads" : "tails";
      const won = result === choice;

      data.coins += won ? bet : -bet;
      save();

      return interaction.reply({
        embeds: [
          makeEmbed("COIN FLIP",
            `🪙 Result: **${result.toUpperCase()}**\n\n` +
            `${won ? "🎉 YOU WON!" : "💀 YOU LOST!"}\n` +
            `${won ? "+" : "-"}${bet} coins`)
        ]
      });
    }

    // ROCK PAPER SCISSORS
    if (commandName === "rps") {
      const choice = interaction.options.getString("choice");
      const choices = ["rock", "paper", "scissors"];
      const computer = choices[Math.floor(Math.random() * 3)];

      const won =
        (choice === "rock" && computer === "scissors") ||
        (choice === "paper" && computer === "rock") ||
        (choice === "scissors" && computer === "paper");

      const tied = choice === computer;

      if (won) data.coins += 25;
      save();

      return interaction.reply(
        `You chose **${choice}**.\nI chose **${computer}**.\n\n` +
        (tied ? "🤝 It's a tie!" :
          won ? "🎉 YOU WIN! +25 coins!" : "💀 YOU LOSE!")
      );
    }

    // LEADERBOARD
    if (commandName === "leaderboard") {
      const ranking = Object.entries(db.users)
        .filter(([key]) => key.startsWith(`${guild.id}:`))
        .sort((a, b) => b[1].coins - a[1].coins)
        .slice(0, 10);

      const lines = await Promise.all(
        ranking.map(async ([key, value], index) => {
          const id = key.split(":")[1];
          const member = await guild.members.fetch(id).catch(() => null);

          return `**${index + 1}.** ${member?.user.username || "Unknown"} — 💰 ${value.coins.toLocaleString()}`;
        })
      );

      return interaction.reply({
        embeds: [
          makeEmbed("SERVER RICHEST",
            lines.join("\n") || "Nobody has coins yet!")
        ]
      });
    }

    // RANK
    if (commandName === "rank") {
      const level = Math.floor(Math.sqrt(data.xp / 100));

      return interaction.reply({
        embeds: [
          makeEmbed("YOUR RANK",
            `⭐ Level: **${level}**\n` +
            `✨ XP: **${data.xp}**\n` +
            `💬 Messages: **${data.messages}**`)
        ]
      });
    }

    // JOKE
    if (commandName === "joke") {
      await interaction.deferReply();

      const response = await fetch(
        "https://v2.jokeapi.dev/joke/Any?safe-mode"
      );

      if (!response.ok) throw new Error("Joke service unavailable.");

      const joke = await response.json();
      const content = joke.type === "twopart"
        ? `${joke.setup}\n\n${joke.delivery}`
        : joke.joke;

      return interaction.editReply({
        embeds: [makeEmbed("RANDOM JOKE", content || "My joke disappeared.")]
      });
    }

    // MEME
    if (commandName === "meme") {
      await interaction.deferReply();

      const response = await fetch("https://meme-api.com/gimme");

      if (!response.ok) throw new Error("Meme service unavailable.");

      const meme = await response.json();

      if (!meme.url || !/^https?:\/\//i.test(meme.url)) {
        return interaction.editReply("The meme machine broke. 😭");
      }

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(YELLOW)
            .setTitle(meme.title || "RANDOM MEME")
            .setImage(meme.url)
            .setFooter({ text: `r/${meme.subreddit || "memes"}` })
        ]
      });
    }

    // ROAST
    if (commandName === "roast") {
      const target = interaction.options.getUser("user");

      if (target.bot || target.id === user.id) {
        return interaction.reply({
          content: "Pick another human. 😭",
          ephemeral: true
        });
      }

      const roasts = [
        "Your Wi-Fi has more personality than you.",
        "Even autocorrect gives up on you.",
        "You're the reason instructions have pictures.",
        "Your brain is running on a free trial.",
        "You bring joy... especially when you leave."
      ];

      return interaction.reply(
        `💀 ${target}, ${roasts[Math.floor(Math.random() * roasts.length)]}`
      );
    }

    // SET WELCOME CHANNEL
    if (commandName === "setwelcome") {
      const channel = interaction.options.getChannel("channel");

      if (!channel.isTextBased() || !channel.guild) {
        return interaction.reply({
          content: "Choose a server text channel.",
          ephemeral: true
        });
      }

      settings.welcomeChannel = channel.id;
      save();

      return interaction.reply(`💛 Welcome channel set to ${channel}!`);
    }

    // SET RANDOM MESSAGE CHANNEL
    if (commandName === "setfun") {
      const channel = interaction.options.getChannel("channel");

      if (!channel.isTextBased() || !channel.guild) {
        return interaction.reply({
          content: "Choose a server text channel.",
          ephemeral: true
        });
      }

      settings.funChannel = channel.id;
      save();

      return interaction.reply(`💛 Random messages will appear in ${channel}!`);
    }

    // KICK AND BAN
    if (commandName === "kick" || commandName === "ban") {
      const target = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason") ||
        "No reason provided.";

      if (target.id === user.id || target.id === client.user.id) {
        return interaction.reply({
          content: "You can't moderate yourself or me!",
          ephemeral: true
        });
      }

      const member = await guild.members.fetch(target.id).catch(() => null);

      if (!member) {
        return interaction.reply({
          content: "Member not found in this server.",
          ephemeral: true
        });
      }

      if (commandName === "kick" && !member.kickable) {
        return interaction.reply({
          content: "I can't kick that member. Check my role position.",
          ephemeral: true
        });
      }

      if (commandName === "ban" && !member.bannable) {
        return interaction.reply({
          content: "I can't ban that member. Check my role position.",
          ephemeral: true
        });
      }

      if (commandName === "kick") {
        await member.kick(reason);
      } else {
        await member.ban({ reason });
      }

      return interaction.reply(
        `✅ ${target.tag} was ${commandName === "kick" ? "kicked" : "banned"}.\nReason: ${reason}`
      );
    }

    // TIMEOUT
    if (commandName === "timeout") {
      const target = interaction.options.getUser("user");
      const minutes = interaction.options.getInteger("minutes");

      if (target.id === user.id || target.id === client.user.id) {
        return interaction.reply({
          content: "You can't timeout yourself or me.",
          ephemeral: true
        });
      }

      const member = await guild.members.fetch(target.id).catch(() => null);

      if (!member || !member.moderatable) {
        return interaction.reply({
          content: "I cannot timeout that member.",
          ephemeral: true
        });
      }

      await member.timeout(minutes * 60000, "Moderator action");

      return interaction.reply(
        `🔇 ${target.tag} timed out for ${minutes} minutes.`
      );
    }

    // CLEAR MESSAGES
    if (commandName === "clear") {
      const amount = interaction.options.getInteger("amount");

      if (!interaction.channel?.bulkDelete) {
        return interaction.reply({
          content: "This channel doesn't support bulk deletion.",
          ephemeral: true
        });
      }

      const deleted = await interaction.channel.bulkDelete(amount, true);

      return interaction.reply({
        content: `🧹 Deleted ${deleted.size} messages.`,
        ephemeral: true
      });
    }

  } catch (error) {
    console.error(`Command error (${commandName}):`, error);

    const reply = {
      content: "Something went wrong. Check the Render logs.",
      ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

// START EVERYTHING
async function start() {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    throw new Error("Missing required environment variables.");
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Health server listening on port ${PORT}`);
  });

  await registerCommands();
  await client.login(TOKEN);
}

start().catch(error => {
  console.error("Startup failed:", error);
  process.exit(1);
});

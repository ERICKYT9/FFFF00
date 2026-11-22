
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
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior
} = require("@discordjs/voice");
const play = require("play-dl");

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
      lastXP: 0,
      lastRob: 0,
      lastCrime: 0
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

// MUSIC PLAYER (YouTube search/URL via play-dl)
const musicQueues = new Map();

function getMusicQueue(guildId) {
  if (!musicQueues.has(guildId)) {
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
    });
    const queue = {
      guildId,
      connection: null,
      player,
      songs: [],
      current: null,
      volume: 50,
      textChannel: null,
      starting: false
    };

    player.on(AudioPlayerStatus.Idle, () => {
      queue.current = null;
      playNext(queue).catch(console.error);
    });
    player.on("error", error => {
      console.error("Music player error:", error);
      queue.textChannel?.send("⚠️ There was a problem playing that track. Skipping...").catch(() => {});
      queue.current = null;
      playNext(queue).catch(console.error);
    });
    musicQueues.set(guildId, queue);
  }
  return musicQueues.get(guildId);
}

async function playNext(queue) {
  if (queue.starting || queue.current || queue.songs.length === 0) return;
  queue.starting = true;
  const song = queue.songs.shift();

  try {
    if (!queue.connection || queue.connection.state.status === VoiceConnectionStatus.Destroyed) {
      queue.starting = false;
      return;
    }
    const stream = await play.stream(song.url, { quality: 2 });
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true
    });
    resource.volume.setVolume(queue.volume / 100);
    queue.current = { ...song, resource };
    queue.player.play(resource);
    queue.textChannel?.send(`🎶 Now playing: **${song.title}**`).catch(() => {});
  } catch (error) {
    console.error("Could not play track:", error);
    queue.textChannel?.send(`⚠️ Couldn't play **${song.title}**. Skipping it.`).catch(() => {});
    queue.current = null;
  } finally {
    queue.starting = false;
    if (!queue.current && queue.songs.length) {
      setImmediate(() => playNext(queue).catch(console.error));
    }
  }
}

function getMemberVoiceChannel(interaction) {
  return interaction.member?.voice?.channel || null;
}

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
    .setName("slots")
    .setDescription("Spin the slot machine for virtual coins")
    .addIntegerOption(o => o.setName("bet")
      .setDescription("Your bet").setMinValue(1).setMaxValue(10000).setRequired(true)),

  new SlashCommandBuilder()
    .setName("dice")
    .setDescription("Guess the die result and win coins")
    .addIntegerOption(o => o.setName("guess")
      .setDescription("Pick a number from 1 to 6").setMinValue(1).setMaxValue(6).setRequired(true))
    .addIntegerOption(o => o.setName("bet")
      .setDescription("Your bet").setMinValue(1).setMaxValue(10000).setRequired(true)),

  new SlashCommandBuilder()
    .setName("rob")
    .setDescription("Try to steal virtual coins from another member")
    .addUserOption(o => o.setName("user")
      .setDescription("Who to rob").setRequired(true)),

  new SlashCommandBuilder()
    .setName("crime")
    .setDescription("Take a risky job for a possible virtual-coin reward"),

  new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Play hit-or-stand blackjack against the dealer")
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
    .setName("play")
    .setDescription("Play a song from YouTube search or URL")
    .addStringOption(o => o.setName("query")
      .setDescription("Song name or YouTube URL").setRequired(true)),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current song"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop music and clear the queue"),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause the current song"),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume the current song"),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the music queue"),

  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Show the current song"),

  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set music volume")
    .addIntegerOption(o => o.setName("amount")
      .setDescription("Volume from 1 to 100").setMinValue(1).setMaxValue(100).setRequired(true)),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Disconnect the bot from voice"),

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
client.once("clientReady", () => {
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
            "**ECONOMY**\n`/balance` `/daily` `/work` `/pay` `/leaderboard` `/rank`\n\n" +
            "**GAMES & COINS**\n`/coinflip` `/rps` `/slots` `/dice` `/rob` `/crime` `/blackjack`\n\n" +
            "**FUN**\n`/joke` `/meme` `/roast`\n\n" +
            "**MUSIC**\n`/play` `/skip` `/stop` `/pause` `/resume` `/queue` `/nowplaying` `/volume` `/leave`\n\n" +
            "**MODERATION**\n`/kick` `/ban` `/timeout` `/clear`")
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

    // SLOTS
    if (commandName === "slots") {
      const bet = interaction.options.getInteger("bet");
      if (data.coins < bet) return interaction.reply({ content: "You don't have enough coins!", ephemeral: true });
      const symbols = ["🍒", "🍋", "🍇", "🍉", "⭐", "💎"];
      const reels = Array.from({ length: 3 }, () => symbols[Math.floor(Math.random() * symbols.length)]);
      let multiplier = 0;
      if (reels.every(x => x === "💎")) multiplier = 10;
      else if (reels.every(x => x === reels[0])) multiplier = 5;
      else if (new Set(reels).size === 2) multiplier = 1.5;
      data.coins -= bet;
      const payout = Math.floor(bet * multiplier);
      data.coins += payout;
      save();
      return interaction.reply({
        embeds: [makeEmbed("SLOT MACHINE", `${reels.join("  ")}\\n\\n` +
          (multiplier ? `🎉 You won **${payout} coins** (${multiplier}x payout)!` : `💀 No match. You lost **${bet} coins**.`) +
          `\\n💰 Balance: **${data.coins.toLocaleString()} coins**`)]
      });
    }

    // DICE
    if (commandName === "dice") {
      const guess = interaction.options.getInteger("guess");
      const bet = interaction.options.getInteger("bet");
      if (data.coins < bet) return interaction.reply({ content: "You don't have enough coins!", ephemeral: true });
      const roll = Math.floor(Math.random() * 6) + 1;
      const won = roll === guess;
      data.coins += won ? bet * 4 : -bet;
      save();
      return interaction.reply({
        embeds: [makeEmbed("DICE ROLL", `🎲 You guessed **${guess}**. The die landed on **${roll}**.\\n\\n` +
          (won ? `🎉 Exact match! You won **${bet * 4} coins** profit!` : `💀 You lost **${bet} coins**.`) +
          `\\n💰 Balance: **${data.coins.toLocaleString()} coins**`)]
      });
    }

    // ROB
    if (commandName === "rob") {
      const target = interaction.options.getUser("user");
      if (target.bot || target.id === user.id) return interaction.reply({ content: "Pick another human, not a bot or yourself.", ephemeral: true });
      const targetData = getUser(guild.id, target.id);
      if (Date.now() - data.lastRob < 30 * 60 * 1000) {
        const mins = Math.ceil((30 * 60 * 1000 - (Date.now() - data.lastRob)) / 60000);
        return interaction.reply({ content: `🚓 You're laying low. Try robbing again in ${mins} minutes.`, ephemeral: true });
      }
      if (targetData.coins < 20) return interaction.reply({ content: "That member doesn't have enough coins to rob.", ephemeral: true });
      data.lastRob = Date.now();
      const success = Math.random() < 0.45;
      if (success) {
        const stolen = Math.min(targetData.coins, Math.floor(Math.random() * 81) + 20);
        targetData.coins -= stolen;
        data.coins += stolen;
        save();
        return interaction.reply(`🦹 You successfully robbed ${target} and stole **${stolen} coins**!`);
      }
      const fine = Math.min(data.coins, Math.floor(Math.random() * 51) + 25);
      data.coins -= fine;
      save();
      return interaction.reply(`🚨 You got caught trying to rob ${target}! You paid a **${fine}-coin fine**.`);
    }

    // CRIME
    if (commandName === "crime") {
      const now = Date.now();
      if (now - data.lastCrime < 20 * 60 * 1000) {
        const mins = Math.ceil((20 * 60 * 1000 - (now - data.lastCrime)) / 60000);
        return interaction.reply({ content: `🚔 Cool off for ${mins} more minutes before your next job.`, ephemeral: true });
      }
      data.lastCrime = now;
      const crimes = [
        "You stole the mayor's garden gnome.",
        "You smuggled 400 rubber ducks.",
        "You hacked a vending machine (it only dispensed soup).",
        "You attempted to steal the server's Wi-Fi."
      ];
      const story = crimes[Math.floor(Math.random() * crimes.length)];
      const success = Math.random() < 0.5;
      if (success) {
        const reward = Math.floor(Math.random() * 201) + 100;
        data.coins += reward;
        save();
        return interaction.reply({ embeds: [makeEmbed("JOB SUCCESS", `${story}\\n\\n💰 You escaped with **${reward} coins**!`)] });
      }
      const fine = Math.min(data.coins, Math.floor(Math.random() * 101) + 25);
      data.coins -= fine;
      save();
      return interaction.reply({ embeds: [makeEmbed("BUSTED", `${story}\\n\\n🚨 You got caught and paid **${fine} coins** in fines.`)] });
    }

    // BLACKJACK
    if (commandName === "blackjack") {
      const bet = interaction.options.getInteger("bet");
      if (data.coins < bet) return interaction.reply({ content: "You don't have enough coins!", ephemeral: true });

      const deck = [];
      for (const suit of ["♠️", "♥️", "♦️", "♣️"]) {
        for (const rank of ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]) {
          deck.push({ rank, suit, value: rank === "A" ? 11 : (["J", "Q", "K"].includes(rank) ? 10 : Number(rank)) });
        }
      }
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      const draw = hand => hand.push(deck.pop());
      const score = hand => {
        let total = hand.reduce((sum, card) => sum + card.value, 0);
        let aces = hand.filter(card => card.rank === "A").length;
        while (total > 21 && aces > 0) { total -= 10; aces--; }
        return total;
      };
      const show = hand => hand.map(card => `${card.rank}${card.suit}`).join("  ");
      const player = [];
      const dealer = [];
      draw(player); draw(dealer); draw(player); draw(dealer);
      const playerBlackjack = score(player) === 21;
      const dealerBlackjack = score(dealer) === 21;

      data.coins -= bet;
      save();

      if (playerBlackjack || dealerBlackjack) {
        if (playerBlackjack && !dealerBlackjack) {
          const payout = Math.floor(bet * 2.5);
          data.coins += payout;
          save();
          return interaction.reply({ embeds: [makeEmbed("BLACKJACK!", `Your hand: ${show(player)} (**21**)\\nDealer: ${show(dealer)} (**${score(dealer)}**)\\n\\n🎉 Blackjack! Payout: **${payout} coins**.`)] });
        }
        if (playerBlackjack && dealerBlackjack) return interaction.reply({ embeds: [makeEmbed("BLACKJACK PUSH", `Both have blackjack. Your **${bet} coins** bet is returned.`)] });
        data.coins -= bet;
        save();
        return interaction.reply({ embeds: [makeEmbed("DEALER BLACKJACK", `Dealer: ${show(dealer)} (**21**)\\nYou: ${show(player)}\\n\\n💀 You lost **${bet} coins**.`)] });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj_hit_${user.id}`).setLabel("Hit").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`bj_stand_${user.id}`).setLabel("Stand").setStyle(ButtonStyle.Primary)
      );
      const gameMessage = await interaction.reply({
        embeds: [makeEmbed("BLACKJACK", `Your hand: ${show(player)} (**${score(player)}**)\\nDealer shows: **${dealer[0].rank}${dealer[0].suit}** and one hidden card\\n\\nBet: **${bet} coins**`)],
        components: [row],
        fetchReply: true
      });
      const collector = gameMessage.createMessageComponentCollector({
        time: 60000,
        filter: i => i.user.id === user.id && i.customId.endsWith(user.id)
      });
      let finished = false;
      const finish = async (resultText, payout = 0) => {
        if (finished) return;
        finished = true;
        if (payout) { data.coins += payout; save(); }
        await gameMessage.edit({
          embeds: [makeEmbed("BLACKJACK", `Your hand: ${show(player)} (**${score(player)}**)\\nDealer: ${show(dealer)} (**${score(dealer)}**)\\n\\n${resultText}\\n💰 Balance: **${data.coins.toLocaleString()} coins**`)],
          components: []
        }).catch(() => {});
        collector.stop();
      };
      collector.on("collect", async i => {
        await i.deferUpdate();
        if (i.customId.startsWith("bj_hit_")) {
          draw(player);
          if (score(player) > 21) return finish(`💥 Bust! You lost **${bet} coins**.`);
          if (score(player) === 21) {
            while (score(dealer) < 17) draw(dealer);
            const ds = score(dealer);
            if (ds > 21 || score(player) > ds) return finish(`🎉 You win! Payout: **${bet * 2} coins**.`, bet * 2);
            if (score(player) === ds) return finish(`🤝 Push! Your bet is returned.`, bet);
            return finish(`💀 Dealer wins. You lost **${bet} coins**.`);
          }
          await gameMessage.edit({
            embeds: [makeEmbed("BLACKJACK", `Your hand: ${show(player)} (**${score(player)}**)\\nDealer shows: **${dealer[0].rank}${dealer[0].suit}** and one hidden card\\n\\nBet: **${bet} coins**`)],
            components: [row]
          }).catch(() => {});
        } else {
          while (score(dealer) < 17) draw(dealer);
          const ps = score(player), ds = score(dealer);
          if (ds > 21 || ps > ds) return finish(`🎉 You win! Payout: **${bet * 2} coins**.`, bet * 2);
          if (ps === ds) return finish("🤝 Push! Your bet is returned.", bet);
          return finish(`💀 Dealer wins. You lost **${bet} coins**.`);
        }
      });
      collector.on("end", async () => {
        if (!finished) {
          finished = true;
          data.coins += bet;
          save();
          await gameMessage.edit({
            content: `⌛ Blackjack expired. Your **${bet} coins** bet was returned.`,
            components: []
          }).catch(() => {});
        }
      });
      return;
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

    // MUSIC COMMANDS
    if (["play", "skip", "stop", "pause", "resume", "queue", "nowplaying", "volume", "leave"].includes(commandName)) {
      const voiceChannel = getMemberVoiceChannel(interaction);
      const queue = getMusicQueue(guild.id);

      if (commandName === "play") {
        if (!voiceChannel) return interaction.reply({ content: "Join a voice channel first!", ephemeral: true });
        await interaction.deferReply();
        const query = interaction.options.getString("query");
        let result;
        try {
          if (/^https?:\/\//i.test(query)) {
            result = await play.video_info(query);
            const video = result.video_details;
            if (!video || !video.url) throw new Error("Unsupported video URL.");
            queue.songs.push({ title: video.title || "Unknown title", url: video.url });
          } else {
            const results = await play.search(query, { limit: 1 });
            if (!results.length) return interaction.editReply("I couldn't find that song.");
            queue.songs.push({ title: results[0].title, url: results[0].url });
          }

          if (!queue.connection || queue.connection.state.status === VoiceConnectionStatus.Destroyed) {
            queue.connection = joinVoiceChannel({
              channelId: voiceChannel.id,
              guildId: guild.id,
              adapterCreator: guild.voiceAdapterCreator,
              selfDeaf: true
            });
            queue.connection.subscribe(queue.player);
            await entersState(queue.connection, VoiceConnectionStatus.Ready, 20_000);
          } else if (queue.connection.joinConfig.channelId !== voiceChannel.id) {
            return interaction.editReply("I'm already playing in another voice channel. Use `/leave` first.");
          }
          queue.textChannel = interaction.channel;
          const added = queue.songs[queue.songs.length - 1];
          if (!queue.current && !queue.starting) await playNext(queue);
          return interaction.editReply(`➕ Added to queue: **${added.title}**`);
        } catch (error) {
          console.error("Play command error:", error);
          return interaction.editReply("I couldn't play that track. Check the URL or try another search.");
        }
      }

      if (!queue.connection || queue.connection.state.status === VoiceConnectionStatus.Destroyed) {
        return interaction.reply({ content: "I'm not playing anything right now.", ephemeral: true });
      }

      if (commandName !== "queue" && !voiceChannel) {
        return interaction.reply({ content: "Join my voice channel to control music.", ephemeral: true });
      }

      if (commandName === "skip") {
        if (!queue.current) return interaction.reply("Nothing is playing.");
        queue.player.stop(true);
        return interaction.reply("⏭️ Skipped the current track.");
      }
      if (commandName === "stop") {
        queue.songs = [];
        queue.current = null;
        queue.player.stop(true);
        return interaction.reply("⏹️ Music stopped and queue cleared.");
      }
      if (commandName === "pause") {
        const paused = queue.player.pause();
        return interaction.reply(paused ? "⏸️ Paused." : "I couldn't pause the track.");
      }
      if (commandName === "resume") {
        const resumed = queue.player.unpause();
        return interaction.reply(resumed ? "▶️ Resumed." : "I couldn't resume the track.");
      }
      if (commandName === "queue") {
        const lines = [];
        if (queue.current) lines.push(`**Now:** ${queue.current.title}`);
        queue.songs.slice(0, 10).forEach((song, index) => lines.push(`**${index + 1}.** ${song.title}`));
        return interaction.reply({ embeds: [makeEmbed("MUSIC QUEUE", lines.join("\\n") || "The queue is empty.")] });
      }
      if (commandName === "nowplaying") {
        return interaction.reply(queue.current ? `🎶 Now playing: **${queue.current.title}**` : "Nothing is playing.");
      }
      if (commandName === "volume") {
        const amount = interaction.options.getInteger("amount");
        queue.volume = amount;
        if (queue.current?.resource?.volume) queue.current.resource.volume.setVolume(amount / 100);
        return interaction.reply(`🔊 Volume set to **${amount}%**.`);
      }
      if (commandName === "leave") {
        queue.songs = [];
        queue.current = null;
        queue.player.stop(true);
        queue.connection.destroy();
        queue.connection = null;
        musicQueues.delete(guild.id);
        return interaction.reply("👋 Left the voice channel.");
      }
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
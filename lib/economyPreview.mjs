import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const WEBSITE_ORIGIN = "https://aidoru.zone.id";
const ASSET_DIR = fileURLToPath(new URL("../assets/", import.meta.url));

const PREVIEW_CONFIG = {
  arcade: {
    url: `${WEBSITE_ORIGIN}/arcade`,
    title: "🎰 AIDORU Arcade",
    description: "Play, bet, spin, and grow your trainer fortune in the AIDORU arcade.",
    image: "arcade/preview-character.jpg",
  },
  daily: {
    url: `${WEBSITE_ORIGIN}/daily`,
    title: "🎁 AIDORU Daily Rewards",
    description: "Claim your extra daily coins on the AIDORU website.",
    image: "aidoru-web-preview.jpg",
  },
  money: {
    url: `${WEBSITE_ORIGIN}/arcade`,
    title: "💰 AIDORU Money Hub",
    description: "Manage your wallet, bank, deposits, withdrawals, and economy progress.",
    image: "economy-preview-dep.jpg",
  },
  pokemon: {
    url: `${WEBSITE_ORIGIN}/battle`,
    title: "⚔️ AIDORU Pokémon Battles",
    description: "Prepare your Pokémon party and enter the AIDORU battle arena.",
    image: "economy-preview-pokemon.jpg",
  },
  mart: {
    url: `${WEBSITE_ORIGIN}/mart`,
    title: "🏪 AIDORU Pokémon Mart",
    description: "Browse Pokémon items, Poké Balls, upgrades, and trainer supplies on AIDORU.",
    image: "economy-preview-mart.jpg",
    renderLargerThumbnail: true,
  },
  shop: {
    url: `${WEBSITE_ORIGIN}/shop`,
    title: "🛒 AIDORU Shop",
    description: "Buy AIDORU economy items on the website.",
    image: "economy-preview-mart.jpg",
  },
  profile: {
    url: `${WEBSITE_ORIGIN}/profile`,
    title: "🌸 AIDORU Trainer Profile",
    description: "View your trainer profile, level, XP, party, and community identity.",
    image: "economy-preview-profile.jpg",
  },
  cards: {
    url: `${WEBSITE_ORIGIN}/cards`,
    title: "🎴 AIDORU Card Collection",
    description: "View your anime cards, collection progress, and card leaderboards.",
    image: "economy-preview-cards.jpg",
  },
  cardshop: {
    url: `${WEBSITE_ORIGIN}/auction`,
    title: "🎴 AIDORU Card Marketplace",
    description: "Browse upcoming card auctions and place bids on the cards you want.",
    image: "economy-preview-cards.jpg",
  },
  lottery: {
    url: `${WEBSITE_ORIGIN}/lottery`,
    title: "AIDORU Lottery",
    description: "Check the current lottery, entrants, prize pool, and your odds.",
    image: "lottery-ticket.svg",
  },
  membership: {
    url: `${WEBSITE_ORIGIN}/membership`,
    title: "AIDORU Membership",
    description: "Compare Basic and Premium membership benefits.",
    image: "economy-preview-profile.jpg",
  },
  community: {
    url: `${WEBSITE_ORIGIN}/dashboard`,
    title: "✨ AIDORU Community Dashboard",
    description: "Track your account, progress, pets, cards, and community adventures.",
    image: "economy-preview-profile.jpg",
  },
};

const COMMAND_KIND = new Map([
  ["deposit", "money"], ["dep", "money"], ["withdraw", "money"], ["wd", "money"],
  ["balance", "arcade"], ["bal", "arcade"],
  ["pay", "money"], ["donate", "money"], ["convert", "money"], ["loan", "money"],
  ["history", "money"], ["diamonds", "money"], ["orbs", "money"],
  ["beg", "arcade"], ["work", "arcade"], ["crime", "arcade"], ["rob", "arcade"],
  ["heist", "arcade"], ["invest", "arcade"], ["pool", "arcade"], ["lottery", "lottery"],
  ["daily", "daily"], ["gamble", "arcade"],
  ["bet", "arcade"], ["blackjack", "arcade"], ["coinflip", "arcade"], ["cf", "arcade"], ["roulette", "arcade"],
  ["slots", "arcade"], ["richg", "arcade"],
  ["challenge", "pokemon"],
  ["mart", "mart"], ["shop", "shop"],
  ["profile", "profile"], ["register", "profile"], ["rename", "profile"],
  ["cardshop", "cardshop"],
  ["membership", "membership"],
  ["setage", "profile"], ["bio", "profile"], ["edit", "profile"],
  ["inventory", "community"], ["use", "community"], ["sell", "community"],
  ["get", "community"], ["mycds", "community"],
  ["slb", "cards"], ["cardleaderboard", "cards"],
]);


const COMMAND_COPY = new Map([
  ["balance", ["AIDORU Account", "Balance"]],
  ["daily", ["🎁 AIDORU Daily Rewards", "Claim your daily coins and keep your streak alive."]],
  ["deposit", ["Deposit successful!", "Bank"]],
  ["dep", ["Deposit successful!", "Bank"]],
  ["withdraw", ["Withdrawal", "Withdraw"]],
  ["wd", ["Withdrawal", "Withdraw"]],
  ["pay", ["Payment sent", "Transfer"]],
  ["donate", ["Donation sent", "Donation"]],
  ["loan", ["Loan", "Account"]],
  ["history", ["Transaction history", "Account"]],
  ["diamonds", ["AIDORU Account", "Diamonds"]],
  ["orbs", ["AIDORU Account", "Orbs"]],
  ["work", ["SHIFT COMPLETED", "Work"]],
  ["beg", ["Beg", "Reward"]],
  ["crime", ["Crime", "Reward"]],
  ["rob", ["Robbery", "Reward"]],
  ["heist", ["Heist", "Reward"]],
  ["invest", ["Investment", "Arcade"]],
  ["pool", ["Lottery Pool", "Investment"]],
  ["lottery", ["AIDORU Lottery", "View entrants, prize pool, and your chance to win."]],
  ["membership", ["AIDORU Membership", "Compare Basic and Premium membership benefits."]],
  ["cardshop", ["AIDORU Card Marketplace", "Browse upcoming card auctions and place bids."]],
  ["gamble", ["Gamble", "Arcade"]],
  ["bet", ["Bet", "Arcade"]],
  ["blackjack", ["Blackjack", "Arcade"]],
  ["coinflip", ["Coinflip", "Arcade"]],
  ["roulette", ["Roulette", "Arcade"]],
  ["slots", ["Slots", "Arcade"]],
  ["challenge", ["AIDORU Battle", "Pokémon"]],
  ["mart", ["AIDORU Pokémon Mart", "Pokémon items"]],
  ["shop", ["AIDORU Shop", "Buy items on the website."]],
  ["profile", ["Trainer Profile", "Profile"]],
  ["register", ["Trainer Profile", "Register"]],
  ["slb", ["Series Leaderboard", "Cards"]],
]);

const COMMAND_PREVIEW_IMAGE = new Map([
  ["balance", "arcade/preview-character.jpg"],
  ["bal", "arcade/preview-character.jpg"],
  ["gamble", "arcade/preview-character.jpg"],
  ["bet", "arcade/preview-character.jpg"],
  ["coinflip", "arcade/preview-character.jpg"],
  ["cf", "arcade/preview-character.jpg"],
  ["slots", "arcade/preview-character.jpg"],
]);

const COMMAND_ALIASES = new Map([["bal", "balance"], ["cf", "coinflip"]]);

function canonicalCommandName(commandName) {
  const name = String(commandName || "").toLowerCase();
  return COMMAND_ALIASES.get(name) || name;
}

function previewImage(commandName, config) {
  return COMMAND_PREVIEW_IMAGE.get(String(commandName || "").toLowerCase())
    || COMMAND_PREVIEW_IMAGE.get(canonicalCommandName(commandName))
    || config.image;
}

const thumbnailPromises = new Map();
const THUMBNAIL_MAX_DIMENSION = 320;
let canvasModulePromise;

async function createPreviewThumbnail(buffer) {
  // Canvas is an optional enhancement for link previews. Load it only when a
  // preview is actually requested so a missing native canvas binary cannot
  // prevent the command manager from registering ordinary text commands.
  if (!canvasModulePromise) {
    canvasModulePromise = import("canvas").catch(() => null);
  }
  const canvasModule = await canvasModulePromise;
  const isJpeg = Buffer.isBuffer(buffer)
    && buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer.at(-2) === 0xff
    && buffer.at(-1) === 0xd9;
  if (!canvasModule) return isJpeg ? buffer : null;

  try {
    const { createCanvas, loadImage } = canvasModule;
    const image = await loadImage(buffer);
    const longestSide = Math.max(image.width, image.height);
    const scale = Math.min(1, THUMBNAIL_MAX_DIMENSION / longestSide);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    canvas.getContext("2d").drawImage(image, 0, 0, width, height);
    return canvas.toBuffer("image/jpeg", {
      quality: 0.82,
      progressive: true,
      chromaSubsampling: true,
    });
  } catch {
    return isJpeg ? buffer : null;
  }
}

function getThumbnail(fileName) {
  if (!thumbnailPromises.has(fileName)) {
    thumbnailPromises.set(
      fileName,
      readFile(`${ASSET_DIR}${fileName}`)
        .then(createPreviewThumbnail)
        .catch(() => null),
    );
  }
  return thumbnailPromises.get(fileName);
}

export function getEconomyPreviewConfig(commandName) {
  const kind = COMMAND_KIND.get(canonicalCommandName(commandName));
  return kind ? PREVIEW_CONFIG[kind] : null;
}

export async function buildEconomyLinkPreview(commandName) {
  const config = getEconomyPreviewConfig(commandName);
  if (!config) return null;
  return {
    "canonical-url": config.url,
    "matched-text": config.url,
    title: COMMAND_COPY.get(canonicalCommandName(commandName))?.[0] || config.title,
    description: COMMAND_COPY.get(canonicalCommandName(commandName))?.[1] || config.description,
    jpegThumbnail: await getThumbnail(previewImage(commandName, config)),
  };
}

export function hasEconomyPreview(commandName) {
  return Boolean(getEconomyPreviewConfig(commandName));
}

export async function buildEconomyExternalAdReply(commandName) {
  const config = getEconomyPreviewConfig(commandName);
  if (!config) return null;
  const thumbnail = await getThumbnail(previewImage(commandName, config));
  return {
    title: COMMAND_COPY.get(canonicalCommandName(commandName))?.[0] || config.title,
    body: COMMAND_COPY.get(canonicalCommandName(commandName))?.[1] || config.description,
    mediaType: 1,
    sourceUrl: config.url,
    thumbnail,
    renderLargerThumbnail: Boolean(config.renderLargerThumbnail),
    showAdAttribution: false,
  };
}

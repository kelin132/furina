import { getUser, isRegistered, saveUser } from "../economy/database.js";

export default {
  name: "activate",
  category: "owner",
  description: "Set a user's membership tier",
  usage: ".activate @user basic | premium | off",
  isOwner: true,
  strictOwner: true,

  async run({ sock, msg, args, discord }) {
    const tier = String(args.at(-1) || "").toLowerCase();
    if (!["basic", "premium", "off"].includes(tier)) {
      return sock.sendMessage(
        msg.key.remoteJid,
        { text: "Usage: .activate @user basic | premium | off" },
        { quoted: msg },
      );
    }
    const targetDiscordId = discord?.message?.mentions?.users?.first?.()?.id;
    const target = targetDiscordId
      ? `discord:${targetDiscordId}`
      : msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
        || (args[0]?.replace(/\D/g, "") ? `${args[0].replace(/\D/g, "")}@s.whatsapp.net` : null);
    if (!target || !await isRegistered(target)) {
      return sock.sendMessage(msg.key.remoteJid, { text: "Choose a registered user to update." }, { quoted: msg });
    }
    const user = await getUser(target);
    const cashEntitlement = { basic: 50_000_000, premium: 70_000_000 };
    const crystalEntitlement = { basic: 20, premium: 30 };
    if (tier !== "off") {
      const cashGrant = Math.max(0, cashEntitlement[tier] - (Number(user.membershipCashGranted) || 0));
      const crystalGrant = Math.max(0, crystalEntitlement[tier] - (Number(user.membershipCrystalsGranted) || 0));
      user.money = (Number(user.money) || 0) + cashGrant;
      user.genesisCrystals = (Number(user.genesisCrystals) || 0) + crystalGrant;
      user.membershipCashGranted = Math.max(Number(user.membershipCashGranted) || 0, cashEntitlement[tier]);
      user.membershipCrystalsGranted = Math.max(Number(user.membershipCrystalsGranted) || 0, crystalEntitlement[tier]);
    }
    user.membershipTier = tier === "off" ? "none" : tier;
    user.isPremium = tier === "premium";
    user.membershipActivatedAt = tier === "off" ? null : Date.now();
    await saveUser(target, user);
    const label = tier === "off" ? "membership removed" : `${tier} membership activated`;
    return sock.sendMessage(
      msg.key.remoteJid,
      { text: `${label} for ${user.name || target}.` },
      { quoted: msg },
    );
  },
};

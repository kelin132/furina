import { randomUUID } from "node:crypto";
import { log } from "./logger.mjs";
import { getDb } from "./mongo.mjs";

const SETTINGS_ID = "default";
const POLL_INTERVAL_MS = 1_000;
const POST_DELAY_MS = 250;
const CLAIM_MS = 2 * 60_000;
const RETRY_MS = 30_000;

let activeSocket = null;
let pollTimer = null;
let pollInProgress = false;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function startWebAuctionAnnouncements(sock) {
  activeSocket = sock;
  if (!pollTimer) {
    pollTimer = setInterval(() => void postNextAuction(), POLL_INTERVAL_MS);
  }
  void postNextAuction();
}

export function pauseWebAuctionAnnouncements(sock) {
  if (activeSocket === sock) activeSocket = null;
}

async function postNextAuction() {
  if (!activeSocket || pollInProgress) return;
  pollInProgress = true;

  let settingsCollection;
  let lockToken;
  try {
    const db = getDb();
    settingsCollection = db.collection("mn_web_auction_settings");
    const now = new Date();
    lockToken = randomUUID();
    const settings = await settingsCollection.findOneAndUpdate(
      {
        _id: SETTINGS_ID,
        announcementGroupJid: { $type: "string" },
        $or: [
          { announcementLockUntil: { $exists: false } },
          { announcementLockUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          announcementLockUntil: new Date(now.getTime() + CLAIM_MS),
          announcementLockToken: lockToken,
        },
      },
      { returnDocument: "after", includeResultMetadata: false },
    );
    if (!settings) return;

    const groupJid = settings.announcementGroupJid;
    if (typeof groupJid !== "string" || !groupJid.endsWith("@g.us")) {
      log("warn", "[auction announcements] Set the target group with .auctiongroup set.");
      return;
    }

    const auctions = db.collection("mn_web_auctions");
    const auction = await auctions.findOneAndUpdate(
      {
        status: "live",
        endsAt: { $gt: now },
        $and: [
          {
            $or: [
              { whatsappAnnouncementState: "pending" },
              { whatsappAnnouncementState: { $exists: false } },
              {
                whatsappAnnouncementState: "sending",
                whatsappAnnouncementClaimUntil: { $lte: now },
              },
            ],
          },
          {
            $or: [
              { whatsappAnnouncementNextAttemptAt: { $exists: false } },
              { whatsappAnnouncementNextAttemptAt: { $lte: now } },
            ],
          },
        ],
      },
      {
        $set: {
          whatsappAnnouncementState: "sending",
          whatsappAnnouncementClaimUntil: new Date(now.getTime() + CLAIM_MS),
        },
        $unset: { whatsappAnnouncementNextAttemptAt: "" },
      },
      {
        sort: { startedAt: 1, createdAt: 1 },
        returnDocument: "after",
        includeResultMetadata: false,
      },
    );
    if (!auction) return;

    const name = String(auction.name || "AIDORU card");
    const category = String(auction.category || "Other");
    const series = String(auction.series || "Unknown series");
    const tier = String(auction.tier || "Card");
    const startingBid = Math.max(0, Number(auction.startingBid) || 0);
    const timeLeft = Math.max(
      0,
      Math.ceil((new Date(auction.endsAt).getTime() - Date.now()) / 60_000),
    );
    const caption = [
      "🃏 *AIDORU CARD EXCHANGE*",
      `*${name}* · ${tier}`,
      `Category: ${category} · ${series}`,
      `Starting bid: $${startingBid.toLocaleString()}`,
      `Time left: ${timeLeft} min`,
      "Bid: https://aidoru.zone.id/auctions",
    ].join("\n");

    try {
      if (typeof auction.media === "string" && /^https:\/\//i.test(auction.media)) {
        await activeSocket.sendMessage(groupJid, {
          image: { url: auction.media },
          caption,
        });
      } else {
        await activeSocket.sendMessage(groupJid, { text: caption });
      }

      await auctions.updateOne(
        {
          _id: auction._id,
          whatsappAnnouncementState: "sending",
          whatsappAnnouncementClaimUntil: new Date(now.getTime() + CLAIM_MS),
        },
        {
          $set: {
            whatsappAnnouncementState: "sent",
            whatsappAnnouncementSentAt: new Date(),
            whatsappAnnouncementGroupJid: groupJid,
          },
          $unset: {
            whatsappAnnouncementClaimUntil: "",
            whatsappAnnouncementNextAttemptAt: "",
          },
        },
      );
      await wait(POST_DELAY_MS);
    } catch (error) {
      await auctions.updateOne(
        {
          _id: auction._id,
          whatsappAnnouncementState: "sending",
          whatsappAnnouncementClaimUntil: new Date(now.getTime() + CLAIM_MS),
        },
        {
          $set: {
            whatsappAnnouncementState: "pending",
            whatsappAnnouncementNextAttemptAt: new Date(Date.now() + RETRY_MS),
            whatsappAnnouncementError: String(error).slice(0, 300),
          },
          $unset: { whatsappAnnouncementClaimUntil: "" },
        },
      );
      log("warn", `[auction announcements] Could not post ${name}: ${String(error)}`);
    }
  } catch (error) {
    log("warn", `[auction announcements] Queue check failed: ${String(error)}`);
  } finally {
    if (settingsCollection && lockToken) {
      await settingsCollection
        .updateOne(
          { _id: SETTINGS_ID, announcementLockToken: lockToken },
          { $unset: { announcementLockUntil: "", announcementLockToken: "" } },
        )
        .catch((error) =>
          log("warn", `[auction announcements] Could not release queue lock: ${String(error)}`),
        );
    }
    pollInProgress = false;
  }
}
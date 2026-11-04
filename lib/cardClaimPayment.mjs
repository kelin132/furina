export async function persistChargedCardClaim({ debit, saveCard, hasCard, refund }) {
  const wallet = await debit();
  if (!wallet) return { status: "insufficient" };

  try {
    await saveCard();
    return { status: "saved", wallet };
  } catch (error) {
    try {
      if (await hasCard()) return { status: "saved", wallet };
    } catch {
      return { status: "uncertain", wallet, error };
    }

    try {
      await refund();
      return { status: "refunded", wallet, error };
    } catch (refundError) {
      return { status: "refund_failed", wallet, error, refundError };
    }
  }
}

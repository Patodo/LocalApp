import { DeliveryStore, type ClickIntent } from "./delivery-store.js";

/** Ticket facade over DeliveryStore's single atomic state image. */
export class ClickTicketStore {
  constructor(private readonly deliveryStore: DeliveryStore) {}

  consume(ticket: string): Promise<ClickIntent | null> {
    return this.deliveryStore.consumeTicket(ticket);
  }

  issueSummary(sourceId: string, expiresAt?: Date): Promise<{ ticket: string; expiresAt: string }> {
    return this.deliveryStore.issueSummary(sourceId, expiresAt);
  }
}

export type { ClickIntent } from "./delivery-store.js";

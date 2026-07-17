import type {
  AddressedBy,
  ChannelInboundContext,
  ConversationScope,
} from "@vibearound/plugin-channel-sdk";

export interface DiscordRouteIdentity {
  channelInstanceId: string;
  actorId: string;
  botUserId?: string | null;
}

export interface DiscordInboundRoute {
  chatId: string;
  topicId?: string;
  senderId?: string;
  platformMessageId?: string;
  scope: ConversationScope;
  addressedBy: AddressedBy;
}

/** Keep the host instance stable; use Discord's bot user ID as the addressed actor. */
export function createDiscordChannelContext(
  identity: DiscordRouteIdentity,
  route: DiscordInboundRoute,
): ChannelInboundContext {
  return {
    channelInstanceId: identity.channelInstanceId,
    actorId: identity.botUserId ?? identity.actorId,
    ...route,
  };
}

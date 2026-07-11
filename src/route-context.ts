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

/** Build the platform-neutral route while preferring Discord's real bot user ID. */
export function createDiscordChannelContext(
  identity: DiscordRouteIdentity,
  route: DiscordInboundRoute,
): ChannelInboundContext {
  return {
    channelInstanceId: identity.botUserId ?? identity.channelInstanceId,
    actorId: identity.actorId,
    ...route,
  };
}

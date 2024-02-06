import { TContext } from "../../utilities";

export const GOTIFY_NOTIFICATION_SENT = "GOTIFY_NOTIFICATION_SENT";
export type GotifyNotificationSentData = {
  application: string;
  context: TContext;
};

import { saveTest } from "./save.mjs";
import { rewardedTest } from "./rewarded.mjs";
import { interstitialTest } from "./interstitial.mjs";
import { audioTest } from "./audio.mjs";
import { languageTest } from "./language.mjs";
import { leaderboardTest } from "./leaderboard.mjs";
import { textAuditTest } from "./text-audit.mjs";
import { moderationTest } from "./moderation.mjs";
import { resolutionTest } from "./resolution.mjs";
import { mobileTest } from "./mobile.mjs";
import { purchasesTest } from "./purchases.mjs";

export const tests = [saveTest, purchasesTest, rewardedTest, interstitialTest, audioTest, languageTest, leaderboardTest, textAuditTest, resolutionTest, mobileTest, moderationTest];
export const testById = new Map(tests.map((test) => [test.id, test]));

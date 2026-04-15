export default function assertConfidenceAdjusted(payload: {
  intentBeforeLearning: { confidence: number };
  intentAfterLearning: { confidence: number };
}): void {
  if (payload.intentAfterLearning.confidence === payload.intentBeforeLearning.confidence) {
    throw new Error(
      `Expected confidence to change after learning adjustment. Before=${payload.intentBeforeLearning.confidence}, After=${payload.intentAfterLearning.confidence}`,
    );
  }
}

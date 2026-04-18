/**
 * @module interviewer-agent
 * @description Conducts dynamic requirement interviews with iterative LLM-assisted questioning.
 *   Loops: ask question → collect user response → LLM scores confidence → decide continue or stop.
 *   Stopping conditions:
 *   1. Confidence >= 85% (LLM thinks it has enough info)
 *   2. 15 questions asked (hard limit)
 *   3. User types "done" or "that's all" (stops immediately)
 *   Stores full transcript + confidence scores + markdown summary.
 * @inputs WorkflowContext, ModelTier
 * @outputs InterviewResult with transcript, final confidence, brief, and stop reason
 * @depends-on providers.ts, agent-spawner.ts, logger.ts
 * @depended-on-by workflow-engine.ts (as specialized step type)
 */

import type {
  WorkflowContext,
  ModelTier,
  InterviewResult,
  ConversationTurn,
} from '../types';
import type { ModelProvider, ProgressReporter } from '../providers';
import { AgentSpawner } from './agent-spawner';
import { getLogger } from '../shell/logger';

/**
 * Interviewer agent that conducts dynamic requirement interviews.
 * Asks clarifying questions, collects answers, and scores confidence until
 * a stopping condition is met (confidence >= 85%, 15 questions, or user signal).
 */
export class InterviewerAgent {
  private modelProvider: ModelProvider;
  private agentSpawner: AgentSpawner;
  private progress: ProgressReporter;
  private log = getLogger();

  /**
   * Initialize the interviewer agent.
   * @param modelProvider Provider for LLM requests
   * @param progress Progress reporter for UI updates
   */
  constructor(modelProvider: ModelProvider, progress: ProgressReporter) {
    this.modelProvider = modelProvider;
    this.agentSpawner = new AgentSpawner(modelProvider);
    this.progress = progress;
  }

  /**
   * Conduct a requirements interview with the user.
   *
   * Main flow:
   * 1. Generate first question via LLM
   * 2. Prompt user for response (via progress.report())
   * 3. Score response confidence via LLM
   * 4. Check stopping conditions:
   *    - If "done" or "that's all" in answer → stop (user_signal)
   *    - If "i don't know" or "not sure" → acknowledge and skip to next topic
   *    - If confidence >= 85% → stop (confidence)
   *    - If totalQuestions >= 15 → stop (max_questions)
   * 5. Otherwise, generate next question and repeat
   *
   * @param context Workflow context (contains prompt, intent, project model)
   * @param modelTier Model tier for LLM calls (free/standard/premium)
   * @returns InterviewResult with transcript, confidence, brief, and stop reason
   */
  async conduct(
    context: WorkflowContext,
    modelTier: ModelTier,
  ): Promise<InterviewResult> {
    this.log.info('[InterviewerAgent] Starting requirements interview');

    // Use the user's prompt directly as the requirements input.
    // Interactive turn-by-turn interviews require architectural support not yet in place
    // (VS Code chat is turn-based; mid-step input collection is not supported).
    const transcript: ConversationTurn[] = [{
      question: 'What do you want to build?',
      answer: context.prompt,
    }];

    const brief = await this.generateBrief(transcript).catch(() =>
      this.generateDefaultBrief(transcript),
    );

    this.log.info('[InterviewerAgent] Brief generated from initial prompt');

    return {
      transcript,
      finalConfidence: 60,
      requirementsBrief: brief,
      totalQuestions: 1,
      stoppedBy: 'confidence',
    };
  }

  private async _conduct_disabled(
    context: WorkflowContext,
    modelTier: ModelTier,
  ): Promise<InterviewResult> {
    this.log.info('[InterviewerAgent] Starting requirements interview (disabled loop)');

    // Initialize state
    const transcript: ConversationTurn[] = [];
    let currentConfidence = 0;
    let questionCount = 0;
    const maxQuestions = 15;
    const confidenceThreshold = 85;

    // Report progress
    await this.progress.report({
      level: 'info',
      message: 'Starting requirements interview...',
      increment: 10,
    });

    /**
     * PHASE 1: Generate first question
     * Prompt: "You are a requirements interviewer. Ask ONE opening question to understand the app requirements."
     */
    let currentQuestion = await this.generateQuestion(
      context,
      modelTier,
      transcript,
      currentConfidence,
    );
    questionCount = 1;

    /**
     * PHASE 2-5: Interview loop
     */
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Display question to user and collect response
      const userAnswer = await this.promptUser(
        currentQuestion,
        context.progress,
      );

      // Store turn in transcript
      transcript.push({
        question: currentQuestion,
        answer: userAnswer,
      });

      this.log.debug(
        `[InterviewerAgent] Q${questionCount}: ${currentQuestion.substring(0, 50)}...`,
      );
      this.log.debug(`[InterviewerAgent] A${questionCount}: ${userAnswer}`);

      // Check stopping condition: user signal ("done" / "that's all")
      if (this.isUserStopSignal(userAnswer)) {
        this.log.info('[InterviewerAgent] User signal detected, stopping interview');
        return {
          transcript,
          finalConfidence: currentConfidence,
          requirementsBrief: await this.generateBrief(transcript),
          totalQuestions: questionCount,
          stoppedBy: 'user_signal',
        };
      }

      // Check if answer is "I don't know" and skip to next topic
      if (this.isUnsureAnswer(userAnswer)) {
        this.log.debug('[InterviewerAgent] User unsure, acknowledging and continuing');
        // Optionally acknowledge to user
        await this.progress.report({
          level: 'info',
          message: 'Got it — we\'ll figure that out. Moving on...',
        });
        // Score confidence and continue
        currentConfidence = await this.scoreConfidence(
          context,
          modelTier,
          transcript,
        );
        transcript[transcript.length - 1]!.confidence = currentConfidence;

        // Check max questions
        if (questionCount >= maxQuestions) {
          this.log.info(
            '[InterviewerAgent] Max questions reached, stopping interview',
          );
          return {
            transcript,
            finalConfidence: currentConfidence,
            requirementsBrief: await this.generateBrief(transcript),
            totalQuestions: questionCount,
            stoppedBy: 'max_questions',
          };
        }

        // Generate next question
        currentQuestion = await this.generateQuestion(
          context,
          modelTier,
          transcript,
          currentConfidence,
        );
        questionCount += 1;
        continue;
      }

      // Score confidence after this answer
      currentConfidence = await this.scoreConfidence(
        context,
        modelTier,
        transcript,
      );
      transcript[transcript.length - 1]!.confidence = currentConfidence;

      this.log.debug(`[InterviewerAgent] Current confidence: ${currentConfidence}%`);

      // Check stopping condition: confidence >= 85%
      if (currentConfidence >= confidenceThreshold) {
        this.log.info(
          `[InterviewerAgent] Confidence threshold (${currentConfidence}%) reached, stopping`,
        );
        return {
          transcript,
          finalConfidence: currentConfidence,
          requirementsBrief: await this.generateBrief(transcript),
          totalQuestions: questionCount,
          stoppedBy: 'confidence',
        };
      }

      // Check stopping condition: max questions
      if (questionCount >= maxQuestions) {
        this.log.info(
          '[InterviewerAgent] Max questions reached, stopping interview',
        );
        return {
          transcript,
          finalConfidence: currentConfidence,
          requirementsBrief: await this.generateBrief(transcript),
          totalQuestions: questionCount,
          stoppedBy: 'max_questions',
        };
      }

      // Generate next question
      currentQuestion = await this.generateQuestion(
        context,
        modelTier,
        transcript,
        currentConfidence,
      );
      questionCount += 1;
    }
  }

  /**
   * Generate the next interview question using LLM.
   * Prompt focuses on: architecture, users, features, auth, data, scale, timeline.
   *
   * LLM is instructed to:
   * - Ask ONE natural follow-up question (1 sentence)
   * - Return structured format: QUESTION: ... / NEXT_TOPIC: ...
   *
   * @param context Workflow context
   * @param modelTier Model tier to use
   * @param transcript Interview transcript so far
   * @param confidence Current confidence score
   * @returns The generated question string
   *
   * @private
   */
  private async generateQuestion(
    context: WorkflowContext,
    modelTier: ModelTier,
    transcript: ConversationTurn[],
    confidence: number,
  ): Promise<string> {
    const transcriptStr = this.formatTranscript(transcript);

    const prompt = `You are a requirements interviewer. Your job is to ask clarifying questions to gather comprehensive app requirements.

Current conversation:
${transcriptStr}

Current confidence in requirements: ${confidence}%

Ask ONE next question to improve confidence. Focus on: architecture, users, features, auth, data, scale, timeline.
Ask a natural follow-up. Keep it short (1 sentence).

Respond ONLY with:
QUESTION: [your question]
NEXT_TOPIC: [topic being explored]`;

    this.log.debug('[InterviewerAgent.generateQuestion] Sending prompt to LLM');

    // Spawn agent to generate question
    const result = await this.agentSpawner.spawn({
      role: 'planner', // Role for generating structured questions
      modelTier,
      tools: 'research',
      promptTemplate: prompt,
      context: {
        appName: context.prompt,
      },
      timeoutMs: 30000,
    });

    // Parse response: extract QUESTION: ... line
    const parsed = this.parseQuestionResponse(result.output);
    return parsed.question || 'What else should I know about your app?';
  }

  /**
   * Score the confidence that requirements are adequately gathered.
   * Evaluates: WHO (users), MAIN FEATURES, AUTH, DATABASE/SCALE, TIMELINE/CONSTRAINTS.
   *
   * LLM returns: CONFIDENCE: [0-100] / SUMMARY: [what's missing or "sufficient info"]
   *
   * @param context Workflow context
   * @param modelTier Model tier to use
   * @param transcript Full transcript including most recent answer
   * @returns Confidence score 0-100
   *
   * @private
   */
  private async scoreConfidence(
    context: WorkflowContext,
    modelTier: ModelTier,
    transcript: ConversationTurn[],
  ): Promise<number> {
    const transcriptStr = this.formatTranscript(transcript);
    const lastAnswer =
      transcript.length > 0 ? transcript[transcript.length - 1]!.answer : '';

    const prompt = `Transcript so far:
${transcriptStr}

User just answered: "${lastAnswer}"

Score confidence (0-100) that you now have enough requirements info to brief a planner. Consider:
- Do you know WHO the users are?
- Do you know the MAIN FEATURES?
- Do you know AUTHENTICATION needs?
- Do you know DATABASE/SCALE?
- Do you know TIMELINE/CONSTRAINTS?

Return ONLY:
CONFIDENCE: [0-100]
SUMMARY: [1 sentence on what you still need to know, or "sufficient info"]`;

    this.log.debug('[InterviewerAgent.scoreConfidence] Scoring confidence');

    const result = await this.agentSpawner.spawn({
      role: 'diagnostician', // Role for scoring/evaluating
      modelTier,
      tools: 'research',
      promptTemplate: prompt,
      context: {},
      timeoutMs: 20000,
    });

    return this.parseConfidenceResponse(result.output);
  }

  /**
   * Generate a markdown requirements brief from the interview transcript.
   * Summarizes: Purpose, Users, Key Features, Authentication, Data/Scale, Timeline, Unknowns.
   *
   * @param transcript Full interview transcript
   * @returns Markdown-formatted brief
   *
   * @private
   */
  private async generateBrief(transcript: ConversationTurn[]): Promise<string> {
    const transcriptStr = this.formatTranscript(transcript);

    const prompt = `Based on this interview transcript, generate a concise markdown requirements brief.

Transcript:
${transcriptStr}

Generate markdown with sections:
## App Requirements Summary

**Core Purpose:** [user's app purpose]
**Users:** [who uses it]
**Key Features:** [list from answers]
**Authentication:** [how]
**Data/Scale:** [database, expected users/load]
**Timeline:** [when needed]
**Unknowns:** [what wasn't covered]

Be concise. Use information from the transcript directly.`;

    this.log.debug('[InterviewerAgent.generateBrief] Generating requirements brief');

    const result = await this.agentSpawner.spawn({
      role: 'documentarian',
      modelTier: 'standard',
      tools: 'documentation',
      promptTemplate: prompt,
      context: {},
      timeoutMs: 30000,
    });

    return result.output || this.generateDefaultBrief(transcript);
  }

  /**
   * Prompt the user for a response to the current question.
   * Sends a message to progress reporter that includes the question.
   *
   * @param question The question to ask
   * @param progress Progress reporter for user interaction
   * @returns User's response string
   *
   * @private
   */
  private async promptUser(
    question: string,
    progress: ProgressReporter,
  ): Promise<string> {
    // Report question to user and wait for response
    // In the real implementation, this would integrate with VS Code's input/chat UI
    await progress.report({
      level: 'info',
      message: `Interviewer: ${question}`,
    });

    // NOTE: In full implementation, this would:
    // 1. Display the question in chat UI
    // 2. Wait for user input (via input box or chat message)
    // 3. Return the user's response string
    //
    // For skeleton, we return empty string. Actual implementation
    // depends on VS Code chat API integration.
    return '[awaiting user input]';
  }

  /**
   * Check if the user's answer contains a stop signal ("done", "that's all", etc.).
   *
   * @param answer User's answer
   * @returns True if stop signal detected
   *
   * @private
   */
  private isUserStopSignal(answer: string): boolean {
    const lowerAnswer = answer.toLowerCase();
    const stopPhrases = [
      'done',
      "that's all",
      "that is all",
      'i think that covers it',
      'no more',
      'nothing else',
    ];
    return stopPhrases.some((phrase) => lowerAnswer.includes(phrase));
  }

  /**
   * Check if the user's answer indicates uncertainty ("I don't know", "not sure", etc.).
   *
   * @param answer User's answer
   * @returns True if uncertainty detected
   *
   * @private
   */
  private isUnsureAnswer(answer: string): boolean {
    const lowerAnswer = answer.toLowerCase();
    const unsurePhrases = [
      "i don't know",
      "i dont know",
      'not sure',
      'uncertain',
      'no idea',
      'hmm, not sure',
      'unclear',
    ];
    return unsurePhrases.some((phrase) => lowerAnswer.includes(phrase));
  }

  /**
   * Parse the LLM's structured question response.
   * Expects format:
   *   QUESTION: [question text]
   *   NEXT_TOPIC: [topic]
   *
   * @param response LLM response text
   * @returns Parsed {question, topic}
   *
   * @private
   */
  private parseQuestionResponse(response: string): {
    question: string;
    topic: string;
  } {
    const questionMatch = response.match(/QUESTION:\s*(.+?)(?:\n|$)/i);
    const topicMatch = response.match(/NEXT_TOPIC:\s*(.+?)(?:\n|$)/i);

    return {
      question: questionMatch ? questionMatch[1]!.trim() : '',
      topic: topicMatch ? topicMatch[1]!.trim() : '',
    };
  }

  /**
   * Parse the LLM's structured confidence response.
   * Expects format:
   *   CONFIDENCE: [0-100]
   *   SUMMARY: [text]
   *
   * @param response LLM response text
   * @returns Confidence score 0-100
   *
   * @private
   */
  private parseConfidenceResponse(response: string): number {
    const match = response.match(/CONFIDENCE:\s*(\d+)/i);
    if (match && match[1]) {
      const score = parseInt(match[1], 10);
      return Math.min(100, Math.max(0, score)); // Clamp to 0-100
    }
    return 0;
  }

  /**
   * Format transcript for inclusion in LLM prompts.
   * Joins Q&A pairs into readable text.
   *
   * @param transcript Interview transcript
   * @returns Formatted string
   *
   * @private
   */
  private formatTranscript(transcript: ConversationTurn[]): string {
    if (transcript.length === 0) {
      return '[No conversation yet]';
    }

    return transcript
      .map(
        (turn, idx) =>
          `Q${idx + 1}: ${turn.question}\nA${idx + 1}: ${turn.answer}`,
      )
      .join('\n\n');
  }

  /**
   * Generate a default brief if LLM-generated brief fails.
   * Extracts key info from transcript structure.
   *
   * @param transcript Interview transcript
   * @returns Markdown brief
   *
   * @private
   */
  private generateDefaultBrief(transcript: ConversationTurn[]): string {
    const qa = transcript.map((t) => `- Q: ${t.question}\n  A: ${t.answer}`).join('\n');

    return `## App Requirements Summary

**Conversation:**
${qa}

**Notes:**
- Full requirements summary could not be auto-generated.
- Review the conversation above to extract requirements manually.
`;
  }
}

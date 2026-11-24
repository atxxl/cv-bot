# Skills, tools and languages

Summary: My skills fall into four groups: AI / LLM engineering, evaluation and experimentation, backend and full-stack development, and machine-learning tooling. Each line below names a skill and where I have used it.

## AI / LLM engineering

- Agentic LLM systems with tool calling and MCP integrations: I run a Claude-based personal agent system (2026 – present) that connects to its tools through MCP.
- Sub-agent orchestration: my personal agent system includes a scheduled sub-agent that executes tasks from a direction file maintained by the main agent.
- Persistent memory and retrieval for agents: my personal agent system keeps persistent memory with hybrid keyword + embedding retrieval.
- LLM observability with Langfuse: I instrumented my personal agent system for trace-level observability (cost, turns, latency per run), with input redaction for the worker that reads private messages.
- Guardrails and control policies for agents: for my personal agent system I set fail-closed pre-execution guardrails for unattended runs and treat all externally sourced content as untrusted input.
- Reviewing and debugging agent-written code: in my personal agent system most of the code is agent-written, and my role is architecture, review, testing and debugging.
- Claude Code: I used it day to day during the mAI internship for codebase onboarding, style-consistent refactoring and documentation.
- Building on the Claude API: cv-bot is a Cloudflare Worker (TypeScript) in front of the Claude API, answering only from source material with citations.

## Evaluation and experimentation

- Evaluation sets for LLM applications: for cv-bot I built a Python evaluation harness with a fixed set of 39 questions (grounded, not-done, out-of-scope and prompt-injection cases), a list of things the bot must never state, and an LLM judge that scores faithfulness and tone.
- Regression testing of prompts: every cv-bot prompt change is run against the same fixed question set and the numbers go into the pull request.
- Metric design and benchmarking: in the final team project of DTU's Deep Learning course we benchmarked four architectures for sarcasm detection (logistic-regression baseline, LSTM, hybrid, Transformer).
- Significance testing: in my MSc thesis I compared models with confusion matrices and tested significance with McNemar's test.
- Class-imbalance handling: my MSc thesis worked on GoEmotions, which has 28 emotion concepts and heavy class imbalance, using data augmentation and hyperparameter tuning.
- Experiment tracking with Weights & Biases: my MSc thesis ran 9 experiment groups and 73 tracked runs on W&B.
- Interpretability (XAI): my MSc thesis studied Concept Bottleneck Models; in the sarcasm-detection team project we used attention visualization and LIME to inspect what each model relied on.
- Evaluating explanations: in a Responsible AI course project at DTU we compared saliency maps with concept-based explanations and designed our own metrics for the explanations themselves.
- Fairness evaluation: in a DTU team project on juvenile-justice risk prediction we assessed fairness under three criteria and applied Equalized Odds post-processing.
- Risk assessment: in a DTU team report I wrote the risk-assessment method, a fault tree analysis and the risk-reduction measures for an autonomous retail robot, following ISO 12100.
- Unsupervised analysis: in a DTU team project on wearable-sensor time series I did the clustering (PCA, K-means, DBSCAN) and reported that it could not separate the task roles.
- Decision trees: in my BSc thesis I trained decision trees on the Moral Machine dataset and chose a white-box model so that every decision path stays explainable.

## Backend and full-stack

- Python backend handlers and APIs: at mAI I wrote the backend scripts for a build-request approval workflow (submit, load pending, approve, reject).
- PostgreSQL / SQL: at mAI I added a new database table for the build-request approval workflow.
- Next.js, TypeScript and React: at mAI I built the pages for requesting and reviewing builds.
- Tailwind is also among the front-end tools I list on my CV.

## Machine learning and tooling

- PyTorch: as a teaching assistant on DTU's Deep Learning course I guided students through building and debugging neural networks in PyTorch.
- scikit-learn: used for the random forest on 4,652 cases in the juvenile-justice risk-prediction team project.
- NLP: my MSc thesis is on sentiment analysis, and the final team project of my Deep Learning course was sarcasm detection with Transformer architectures.
- Docker, GitHub Actions and Hydra: I used them in a DTU team project that built a reproducible ML pipeline.
- Git and GitHub: cv-bot is developed in the open on GitHub through issues and pull requests, and I review and merge every pull request.

## Languages

- I speak Danish and English at a proficient level, and Mandarin and Cantonese natively.
- My BSc in Computer Science at the University of Copenhagen was completed in Danish.

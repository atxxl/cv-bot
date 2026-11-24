# Course projects at DTU

Summary: Six course projects from the MSc at DTU, all done in teams: sarcasm detection with Transformer architectures (2024), an MLOps pipeline for reproducible ML (2024), saliency maps versus concept-based explanations (2023), a risk assessment of an autonomous retail robot (2023), fairness in juvenile-justice risk prediction (2023), and a wearable-sensor time-series analysis (2023).

## Sarcasm Detection with Transformer Architectures, 2024

- The final project in DTU course 02456 Deep Learning, done in a team in 2024.
- In the sarcasm-detection project we trained three attention-based models on the News Headlines Dataset for Sarcasm Detection: an attention-based LSTM, a hybrid of a 1D CNN and a bidirectional LSTM with attention, and a 6-layer Transformer encoder, with logistic regression as the baseline.
- Sarcasm-detection results: the Transformer reached 86% accuracy and 0.86 F1; the hybrid model 84% accuracy, the attention LSTM 83%, and the logistic-regression baseline 82%.
- In the sarcasm-detection project I was responsible for the hybrid model and the explainability analysis.
- In the sarcasm-detection project we compared two ways of explaining the predictions: the models' own attention weights and LIME.
- Finding of the sarcasm-detection project: the hybrid model's attention and LIME on the Transformer agreed on the words that carry the sarcasm, while the attention weights of the LSTM and the Transformer came out nearly flat; the report states this and does not claim to explain it.
- Limitations stated in the sarcasm-detection report: the LSTM and hybrid models showed signs of overfitting, and the data are news headlines from US websites only.

## MLOps Pipeline for Reproducible ML (ML-Art), 2024

- A team project in DTU course 02476 Machine Learning Operations in 2024: a reproducible ML pipeline built with Docker, GitHub Actions, Hydra and Weights & Biases.
- The MLOps pipeline covers automated experiment tracking, data versioning, pre-commit hooks and cross-environment reproducibility.

## Saliency Maps vs Concepts, 2023

- A team project in DTU course 02517 Responsible AI: Algorithmic Fairness and Explainability in 2023: we compared a fine-tuned ResNet34 with a concept bottleneck model on CUB-200 (11,788 bird images).
- In the saliency-maps project we designed our own metrics for the explanations themselves: overlap of salient pixels with the bounding box (IoU 0.29–0.36), annotated parts within 50 px of the most salient pixels (66.7%), and whether the concept predictions were correct (112/112).
- Finding of the saliency-maps project: the saliency maps covered the whole bird rather than any distinguishing feature; the concept explanations were easier to read but had no visual grounding.

## Risk Assessment of an Autonomous Retail Robot (StockBot), 2023

- A team report in DTU course 34760 Safety and Reliability in Robotic and Automation Systems in 2023, following ISO 12100.
- In the StockBot risk assessment I wrote the risk-assessment method, the fault tree analysis and the risk-reduction measures for each identified hazard.
- The StockBot fault tree analysis has 20 basic events in five failure classes and a top-event probability of 0.81, reported as an estimate because manufacturer failure data were not available.

## Fairness in Juvenile-Justice Risk Prediction (Catalonia dataset), 2023

- A team project in DTU course 02517 Responsible AI: Algorithmic Fairness and Explainability in 2023: a random forest trained with scikit-learn on 4,652 cases from the Catalonia juvenile-justice dataset.
- The juvenile-justice model was evaluated with precision, recall, F1, ROC and calibration.
- In the juvenile-justice project we assessed fairness under three criteria and applied Equalized Odds post-processing.

## Wearable Sensor Time Series: Clustering and Tensor Decomposition, 2023

- A team project in DTU course 02582 Computational Data Analysis in 2023, on four biosignals from E4 wearable sensors (EDA, heart rate, temperature, BVP), aligned to a common 1 Hz timeline per participant.
- In the wearable-sensor project I did the unsupervised analysis: PCA, then K-means and DBSCAN (silhouette up to 0.64). Neither could separate the two task roles, and the report says so.
- I contributed to the team's Tucker3 decomposition (26 × 3,550 × 4) in the wearable-sensor project, which kept the time dimension: there the two roles formed distinct groups and the time loadings followed the rounds of the experiment.

# Стем для постановки

Сравнивается сила атаки в окне ±0,08 с у начала уже доказанного слова. Контроль — те же окна на ±0,25 с и ±0,40 с. Кандидат заменяет отрезок, только если атака у слова сильнее хотя бы на 5 % и отношение к контролю не хуже. Стем песни остаётся htdemucs: полный проход более тяжёлой модели в 150 минут не входит. Веса не коммитятся.

| песня | выбрано | почему | слов | клипов | секунды |
|---|---|---|---:|---:|---:|
| i-have-come-alive | htdemucs_ft | база | 12 | 12 | 480.3 |
| karitas | htdemucs_ft | база | 12 | 12 | 604.1 |
| one | htdemucs_ft | база | 12 | 12 | 626.2 |

| песня | кандидат | лицензия | слов | медиана у слова | медиана контроля | отношение | ошибка |
|---|---|---|---:|---:|---:|---:|---|
| i-have-come-alive | htdemucs_ft | MIT | 12 | 1.0113 | 0.3276 | 3.0872 | — |
| i-have-come-alive | htdemucs | MIT | 12 | 0.8527 | 0.3013 | 2.8299 | — |
| i-have-come-alive | htdemucs_ft-overlap | MIT | 12 | 0.9766 | 0.3312 | 2.9484 | — |
| i-have-come-alive | htdemucs_ft-shifts2 | MIT | 12 | 0.9521 | 0.3149 | 3.0233 | — |
| i-have-come-alive | mdx_extra | MIT | 12 | 1.0103 | 0.2648 | 3.8153 | — |
| i-have-come-alive | ensemble-htdemucs-ft | MIT | 12 | 0.9351 | 0.3253 | 2.8749 | — |
| karitas | htdemucs_ft | MIT | 12 | 1.1068 | 0.2773 | 3.9916 | — |
| karitas | htdemucs | MIT | 12 | 0.7256 | 0.2885 | 2.5149 | — |
| karitas | htdemucs_ft-overlap | MIT | 12 | 1.1053 | 0.2644 | 4.1809 | — |
| karitas | htdemucs_ft-shifts2 | MIT | 12 | 1.1214 | 0.2767 | 4.0524 | — |
| karitas | mdx_extra | MIT | — | — | — | — | бюджет |
| karitas | ensemble-htdemucs-ft | MIT | 12 | 0.8812 | 0.3065 | 2.8753 | — |
| one | htdemucs_ft | MIT | 12 | 1.0013 | 0.456 | 2.196 | — |
| one | htdemucs | MIT | 12 | 0.9389 | 0.4122 | 2.2779 | — |
| one | htdemucs_ft-overlap | MIT | 12 | 0.9829 | 0.4128 | 2.3811 | — |
| one | htdemucs_ft-shifts2 | MIT | 10 | 0.9667 | 0.4753 | 2.0339 | — |
| one | mdx_extra | MIT | — | — | — | — | бюджет |
| one | ensemble-htdemucs-ft | MIT | 12 | 0.9881 | 0.4178 | 2.3647 | — |

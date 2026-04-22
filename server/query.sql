WITH questions_raw AS (
    SELECT
        id,
        tags,
        creation_date
    FROM `bigquery-public-data.stackoverflow.posts_questions`
)

SELECT
    id,
    tag,
    creation_date
FROM questions_raw,
UNNEST(SPLIT(tags, '|')) AS tag

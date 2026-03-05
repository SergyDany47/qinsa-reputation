-- Schema completo de Qinsa Reputation
-- Ejecutar en Supabase SQL Editor

-- Tabla: restaurants
CREATE TABLE IF NOT EXISTS restaurants (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    address         text,
    neighborhood    text,
    city            text DEFAULT 'Madrid',
    category        text,
    google_maps_url text,
    google_rating   numeric(2,1),
    review_count    integer,
    response_rate   numeric(5,2),
    profile_status  text DEFAULT 'prospect'
                    CHECK (profile_status IN ('prospect', 'visited', 'lead', 'client')),
    created_at      timestamptz DEFAULT now()
);

-- Tabla: reviews
CREATE TABLE IF NOT EXISTS reviews (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid REFERENCES restaurants(id) ON DELETE CASCADE,
    source          text DEFAULT 'google',
    author_name     text,
    rating          integer CHECK (rating BETWEEN 1 AND 5),
    text            text,
    review_date     date,
    owner_replied   boolean DEFAULT false,
    reply_text      text,
    collected_at    timestamptz DEFAULT now()
);

-- Tabla: insights
CREATE TABLE IF NOT EXISTS insights (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid REFERENCES restaurants(id) ON DELETE CASCADE,
    top_problems    jsonb,
    top_strengths   jsonb,
    keywords        jsonb,
    summary         text,
    sentiment_score numeric(4,2),
    response_quality text,
    generated_at    timestamptz DEFAULT now(),
    model_used      text DEFAULT 'google-natural-language'
);

-- Tabla: field_visits
CREATE TABLE IF NOT EXISTS field_visits (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid REFERENCES restaurants(id) ON DELETE CASCADE,
    visit_date      date DEFAULT CURRENT_DATE,
    visited_by      text,
    status          text DEFAULT 'pending'
                    CHECK (status IN ('pending', 'visited', 'interested', 'rejected')),
    owner_met       boolean DEFAULT false,
    demo_shown      boolean DEFAULT false,
    reaction_score  integer CHECK (reaction_score BETWEEN 1 AND 5),
    notes           text,
    follow_up_date  date
);

-- Tabla: survey_responses
CREATE TABLE IF NOT EXISTS survey_responses (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id           uuid REFERENCES restaurants(id) ON DELETE CASCADE,
    owner_name              text,
    q1_time_weekly          text,
    q2_tools_used           text,
    q3_google_importance    integer CHECK (q3_google_importance BETWEEN 1 AND 5),
    q4_biggest_pain         text,
    q5_willing_to_use       text,
    submitted_at            timestamptz DEFAULT now()
);

-- Tabla: leads
CREATE TABLE IF NOT EXISTS leads (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid REFERENCES restaurants(id) ON DELETE CASCADE,
    owner_name      text,
    email           text,
    phone           text,
    plan_interest   text CHECK (plan_interest IN ('basic', 'growth', 'undecided')),
    demo_requested  boolean DEFAULT false,
    source          text CHECK (source IN ('field_visit', 'landing', 'referral')),
    created_at      timestamptz DEFAULT now(),
    contacted_at    timestamptz
);

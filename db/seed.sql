-- Demo data only — for local / Railway testing. Delete before launch.
INSERT INTO authors (name, bio, skin, song_title, song_artist, song_url)
VALUES ('May', 'A life storyteller on BioLifeDrive.', 'classic-blue',
        'My Story Song', 'Demo Artist', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
ON CONFLICT DO NOTHING;

INSERT INTO stories (author_id, title, body, category)
SELECT id, 'The Life Of A Fixer', 'A demo story about fixing things and fixing a life, one repair at a time.', 'Life story'
FROM authors WHERE name = 'May';

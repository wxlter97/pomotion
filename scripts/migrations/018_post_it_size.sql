-- Tamaño de cada post-it: el usuario puede cambiar ancho y alto arrastrando
-- la esquina y la preferencia se guarda por nota. NULL = tamaño por defecto
-- (las notas que ya existían se quedan como estaban).

ALTER TABLE post_its ADD COLUMN width INTEGER;
ALTER TABLE post_its ADD COLUMN height INTEGER;

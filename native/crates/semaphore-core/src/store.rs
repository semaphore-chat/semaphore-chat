//! A conversation's loaded window of rows: `seq` assignment, the id and nonce indexes, older-page
//! loading, and eviction, which never crosses a span held by `Core::hold_rows`. Unit U5.

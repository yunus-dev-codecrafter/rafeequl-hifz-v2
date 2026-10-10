<?php
// Root router for InfinityFree hosting
session_start();

// If user is logged in, send them to the dashboard, otherwise send them to index.html/login
if (isset($_SESSION['user_id'])) {
    header("Location: web/dashboard.html");
} else {
    header("Location: web/index.html");
}
exit();
?>
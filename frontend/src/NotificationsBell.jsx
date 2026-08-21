import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Box, Button, Divider, Popover, Stack, Tooltip, Typography } from "@mui/material";

import { getNotifications } from "./notificationsApi";

function BellIcon() {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      sx={{ width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 1.95, strokeLinecap: "round", strokeLinejoin: "round" }}
      aria-hidden="true"
    >
      <path d="M6.5 16.5h11l-1.4-2.2a4.2 4.2 0 0 1-.6-2.2V10a3.5 3.5 0 1 0-7 0v2.1a4.2 4.2 0 0 1-.6 2.2z" />
      <path d="M10 18.5a2.2 2.2 0 0 0 4 0" />
    </Box>
  );
}

export default function NotificationsBell({ variant = "sidebar", tooltipPlacement = "top" }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: getNotifications,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const notifications = query.data ?? [];
  const isHome = variant === "home";

  function openNotification(notification) {
    setAnchorEl(null);
    navigate(notification.href);
  }

  return (
    <>
      <Tooltip title="Notifiche" placement={tooltipPlacement}>
        <Button
          onClick={(event) => setAnchorEl(event.currentTarget)}
          aria-label={`Notifiche${notifications.length ? `: ${notifications.length} attive` : ""}`}
          sx={{
            minWidth: 0,
            width: isHome ? 38 : 32,
            height: isHome ? 38 : 32,
            borderRadius: "10px",
            color: isHome ? "#fff" : "var(--color-sidebar-text-muted)",
            bgcolor: isHome ? "rgba(255,255,255,0.12)" : "transparent",
            border: isHome ? "1px solid rgba(255,255,255,0.22)" : "none",
            "&:hover": {
              bgcolor: isHome ? "rgba(255,255,255,0.2)" : "var(--color-sidebar-hover-bg)",
            },
          }}
        >
          <Badge badgeContent={notifications.length} color="error" max={9} overlap="circular">
            <BellIcon />
          </Badge>
        </Button>
      </Tooltip>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: isHome ? "bottom" : "top", horizontal: "right" }}
        transformOrigin={{ vertical: isHome ? "top" : "bottom", horizontal: "right" }}
        slotProps={{ paper: { sx: { borderRadius: "14px", boxShadow: "0 4px 24px rgba(0,0,0,0.10)", width: 340, maxWidth: "calc(100vw - 24px)" } } }}
      >
        <Box sx={{ px: 2, pt: 2, pb: 1.5 }}>
          <Typography fontWeight={700} fontSize={15}>Notifiche</Typography>
        </Box>
        <Divider />
        {query.isError ? (
          <Box sx={{ px: 2, py: 3, textAlign: "center" }}>
            <Typography fontSize={14} color="text.secondary">Notifiche temporaneamente non disponibili</Typography>
          </Box>
        ) : notifications.length === 0 ? (
          <Box sx={{ px: 2, py: 3, textAlign: "center" }}>
            <Typography fontSize={14} color="text.secondary">Nessuna notifica al momento</Typography>
          </Box>
        ) : (
          <Stack divider={<Divider flexItem />}>
            {notifications.map((notification) => (
              <Button
                key={notification.id}
                onClick={() => openNotification(notification)}
                sx={{ px: 2, py: 1.5, display: "block", textAlign: "left", textTransform: "none", borderRadius: 0, color: "text.primary" }}
              >
                <Typography fontSize={13} fontWeight={750}>{notification.title}</Typography>
                <Typography fontSize={12} color="text.secondary" sx={{ mt: 0.35 }}>{notification.message}</Typography>
                {notification.detail && (
                  <Typography fontSize={11} color="text.disabled" sx={{ mt: 0.5 }}>
                    {notification.detail}
                  </Typography>
                )}
              </Button>
            ))}
          </Stack>
        )}
      </Popover>
    </>
  );
}

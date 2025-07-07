import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import mqtt from "mqtt";

// Fixed Main MQTT hook - handles connection and basic operations
export const useMQTT = ({ options = {} }) => {
  const [client, setClient] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [messages, setMessages] = useState([]);
  const clientRef = useRef(null);
  const optionsRef = useRef(options);

  // ✅ Fix: Memoize options to prevent infinite re-renders
  const stableOptions = useMemo(
    () => ({
      username: options?.username,
      password: options?.password,
      connectionUrl: options?.connectionUrl,
      reconnectPeriod: options?.reconnectPeriod || 1000,
      clean: options?.clean !== undefined ? options.clean : true,
      connectTimeout: options?.connectTimeout || 4000,
      ...options?.additionalOptions,
    }),
    [
      options?.username,
      options?.password,
      options?.connectionUrl,
      options?.reconnectPeriod,
      options?.clean,
      options?.connectTimeout,
    ]
  );

  // Update options ref when they change
  useEffect(() => {
    optionsRef.current = stableOptions;
  }, [stableOptions]);

  // Connect to MQTT broker
  const connect = useCallback(() => {
    if (!clientRef.current && optionsRef.current?.connectionUrl) {
      const credentialOptions = {
        username: optionsRef.current.username,
        password: optionsRef.current.password,
        reconnectPeriod: optionsRef.current.reconnectPeriod || 1000,
        clean:
          optionsRef.current.clean !== undefined
            ? optionsRef.current.clean
            : true,
        connectTimeout: optionsRef.current.connectTimeout || 4000,
        ...optionsRef.current.additionalOptions,
      };

      setConnectionStatus("connecting");
      const mqttClient = mqtt.connect(
        optionsRef.current.connectionUrl,
        credentialOptions
      );
      clientRef.current = mqttClient;
      setClient(mqttClient);

      mqttClient.on("connect", () => {
        console.log("✅ MQTT Connected");
        setIsConnected(true);
        setConnectionStatus("connected");
      });

      mqttClient.on("error", (err) => {
        console.error("❌ MQTT Error:", err);
        setIsConnected(false);
        setConnectionStatus("error");
      });

      mqttClient.on("close", () => {
        console.log("🔌 MQTT Disconnected");
        setIsConnected(false);
        setConnectionStatus("disconnected");
      });

      mqttClient.on("reconnect", () => {
        console.log("🔄 MQTT Reconnecting...");
        setConnectionStatus("reconnecting");
      });

      mqttClient.on("offline", () => {
        console.log("📴 MQTT Offline");
        setIsConnected(false);
        setConnectionStatus("offline");
      });

      // Global message handler
      mqttClient.on("message", (topic, message) => {
        const messageData = {
          topic,
          message: message.toString(),
          timestamp: Date.now(),
        };
        console.log(`📨 Received from ${topic}: ${message.toString()}`);
        setMessages((prev) => [...prev.slice(-99), messageData]); // Keep last 100 messages
      });
    }
  }, []); // ✅ Fix: Empty dependency array

  // Disconnect from MQTT broker
  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.end(true);
      clientRef.current = null;
      setClient(null);
      setIsConnected(false);
      setConnectionStatus("disconnected");
      setMessages([]);
    }
  }, []);

  // Publish message
  const publish = useCallback(
    (topic, message, publishOptions = {}, callback) => {
      if (!clientRef.current || !isConnected) {
        console.warn("⚠️ MQTT client not ready for publishing");
        if (callback) callback(new Error("MQTT client not ready"));
        return Promise.reject(new Error("MQTT client not ready"));
      }

      const messageStr =
        typeof message === "string" ? message : JSON.stringify(message);

      return new Promise((resolve, reject) => {
        clientRef.current.publish(topic, messageStr, publishOptions, (err) => {
          if (err) {
            console.error("❌ Publish error:", err);
            if (callback) callback(err);
            reject(err);
          } else {
            console.log("📤 Published to", topic, "Message:", messageStr);
            if (callback) callback(null);
            resolve();
          }
        });
      });
    },
    [isConnected]
  );

  // Clear messages
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // Get messages for specific topic
  const getMessagesForTopic = useCallback(
    (topic) => {
      return messages.filter((msg) => msg.topic === topic);
    },
    [messages]
  );

  // ✅ Fix: Auto-connect only when connectionUrl changes
  useEffect(() => {
    if (stableOptions.connectionUrl) {
      connect();
    }

    // Cleanup on unmount
    return () => {
      disconnect();
    };
  }, [stableOptions.connectionUrl, connect, disconnect]);

  // Return basic MQTT functionality
  return {
    client,
    isConnected,
    connectionStatus,
    publish,
    messages,
    clearMessages,
    getMessagesForTopic,
    connect,
    disconnect,
    messageCount: messages.length,
  };
};

// Fixed Custom hook for subscription management
export const useSubscription = ({ options = {}, topics = [], onMessage }) => {
  const mqttHook = useMQTT({ options });
  const { client, isConnected } = mqttHook;

  const [subscribedTopics, setSubscribedTopics] = useState([]);
  const [subscriptionMessages, setSubscriptionMessages] = useState([]);

  // ✅ Fix: Memoize topics to prevent infinite re-renders
  const stableTopics = useMemo(() => {
    return Array.isArray(topics) ? topics : [topics];
  }, [JSON.stringify(topics)]);

  // ✅ Fix: Memoize onMessage callback
  const stableOnMessage = useCallback(
    (topic, message, messageData) => {
      if (onMessage) {
        onMessage(topic, message, messageData);
      }
    },
    [onMessage]
  );

  // Subscribe to topics
  const subscribe = useCallback(
    (topicsToSubscribe, callback) => {
      if (!client || !isConnected) {
        console.warn("MQTT client not ready for subscription");
        if (callback) callback(new Error("MQTT client not ready"));
        return Promise.reject(new Error("MQTT client not ready"));
      }

      const topicsArray = Array.isArray(topicsToSubscribe)
        ? topicsToSubscribe
        : [topicsToSubscribe];

      return new Promise((resolve, reject) => {
        client.subscribe(topicsArray, (err) => {
          if (err) {
            console.error("Subscribe error:", err);
            if (callback) callback(err);
            reject(err);
          } else {
            console.log("Subscribed to", topicsArray);
            setSubscribedTopics((prev) => [
              ...new Set([...prev, ...topicsArray]),
            ]);
            if (callback) callback(null, topicsArray);
            resolve(topicsArray);
          }
        });
      });
    },
    [client, isConnected]
  );

  // Unsubscribe from topics
  const unsubscribe = useCallback(
    (topicsToUnsubscribe, callback) => {
      if (!client || !isConnected) {
        console.warn("MQTT client not ready for unsubscription");
        if (callback) callback(new Error("MQTT client not ready"));
        return Promise.reject(new Error("MQTT client not ready"));
      }

      const topicsArray = Array.isArray(topicsToUnsubscribe)
        ? topicsToUnsubscribe
        : [topicsToUnsubscribe];

      return new Promise((resolve, reject) => {
        client.unsubscribe(topicsArray, (err) => {
          if (err) {
            console.error("Unsubscribe error:", err);
            if (callback) callback(err);
            reject(err);
          } else {
            console.log("Unsubscribed from", topicsArray);
            setSubscribedTopics((prev) =>
              prev.filter((topic) => !topicsArray.includes(topic))
            );
            if (callback) callback(null, topicsArray);
            resolve(topicsArray);
          }
        });
      });
    },
    [client, isConnected]
  );

  // Check if subscribed to topic
  const isSubscribed = useCallback(
    (topic) => {
      return subscribedTopics.includes(topic);
    },
    [subscribedTopics]
  );

  // ✅ Fix: Auto-subscribe to topics from props
  useEffect(() => {
    if (!client || !isConnected || stableTopics.length === 0) return;

    const newTopics = stableTopics.filter(
      (topic) => !subscribedTopics.includes(topic)
    );
    if (newTopics.length > 0) {
      subscribe(newTopics).catch((err) => {
        console.error("Auto-subscribe failed:", err);
      });
    }
  }, [client, isConnected, stableTopics, subscribedTopics, subscribe]);

  // ✅ Fix: Handle incoming messages for subscribed topics
  useEffect(() => {
    if (!client || !isConnected || subscribedTopics.length === 0) return;

    const messageHandler = (topic, message) => {
      if (subscribedTopics.includes(topic)) {
        const messageData = {
          topic,
          message: message.toString(),
          timestamp: Date.now(),
        };

        setSubscriptionMessages((prev) => [...prev.slice(-99), messageData]);
        stableOnMessage(topic, message.toString(), messageData);
      }
    };

    client.on("message", messageHandler);

    return () => {
      client.off("message", messageHandler);
    };
  }, [client, isConnected, subscribedTopics, stableOnMessage]);

  // Clear subscription messages
  const clearSubscriptionMessages = useCallback(() => {
    setSubscriptionMessages([]);
  }, []);

  return {
    // Include all mqtt hook data
    ...mqttHook,
    // Subscription-specific data
    subscribedTopics,
    isSubscribed,
    subscribe,
    unsubscribe,
    subscriptionMessages,
    clearSubscriptionMessages,
    subscriptionCount: subscribedTopics.length,
  };
};

// Fixed Combined hook
export const useMQTTWithSubscription = ({
  options = {},
  topics = [],
  onMessage,
}) => {
  return useSubscription({ options, topics, onMessage });
};

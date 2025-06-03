import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, onSnapshot, doc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';

// Context for Firebase services and user data
const FirebaseContext = createContext(null);

// Firebase Provider component
const FirebaseProvider = ({ children }) => {
    const [app, setApp] = useState(null);
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        try {
            // Initialize Firebase
            // const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
            // Initialize Firebase
            const firebaseConfig = {
                apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
                authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
                projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
                storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
                messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
                appId: import.meta.env.VITE_FIREBASE_APP_ID,
                measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID // Include if present
            };
            const appId = firebaseConfig.appId; // Use the appId from your config
            const firebaseApp = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(firebaseApp);
            const firebaseAuth = getAuth(firebaseApp);

            setApp(firebaseApp);
            setDb(firestoreDb);
            setAuth(firebaseAuth);

            // Sign in with custom token if available, otherwise anonymously
            const signIn = async () => {
                try {
                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                        await signInWithCustomToken(firebaseAuth, __initial_auth_token);
                    } else {
                        await signInAnonymously(firebaseAuth);
                    }
                } catch (e) {
                    console.error("Firebase Auth Error:", e);
                    setError("Failed to authenticate with Firebase.");
                }
            };

            signIn();

            // Listen for auth state changes
            const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    setUserId(null);
                }
                setLoading(false);
            });

            return () => unsubscribe(); // Cleanup auth listener
        } catch (e) {
            console.error("Firebase Initialization Error:", e);
            setError("Failed to initialize Firebase.");
            setLoading(false);
        }
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="text-lg font-semibold text-gray-700">Loading application...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-red-100 text-red-700">
                Error: {error} Please check your Firebase configuration.
            </div>
        );
    }

    return (
        <FirebaseContext.Provider value={{ db, auth, userId }}>
            {children}
        </FirebaseContext.Provider>
    );
};

// Custom hook to use Firebase context
const useFirebase = () => {
    const context = useContext(FirebaseContext);
    if (!context) {
        throw new Error('useFirebase must be used within a FirebaseProvider');
    }
    return context;
};

// Reusable Modal Component
const Modal = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-auto p-6">
                <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                    <h3 className="text-xl font-semibold text-gray-800">{title}</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl leading-none">&times;</button>
                </div>
                <div className="py-4">
                    {children}
                </div>
                <div className="flex justify-end pt-3 border-t border-gray-200">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

// Rule Management Component
const RuleManagement = () => {
    const { db, userId } = useFirebase();
    const [rules, setRules] = useState([]);
    const [newRule, setNewRule] = useState({
        name: '',
        type: 'Naming Convention',
        platform: 'Facebook Ads',
        condition: '',
        message: '',
        isActive: true,
    });
    const [editingRule, setEditingRule] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [message, setMessage] = useState('');
    const [llmLoading, setLlmLoading] = useState(false); // New state for LLM loading
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    // Firestore collection path for rules
    const getRulesCollectionRef = () => {
        if (!db || !userId) return null;
        return collection(db, `artifacts/${appId}/users/${userId}/rules`);
    };

    // Fetch rules from Firestore
    useEffect(() => {
        const rulesCollectionRef = getRulesCollectionRef();
        if (!rulesCollectionRef) return;

        const unsubscribe = onSnapshot(rulesCollectionRef, (snapshot) => {
            const rulesData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setRules(rulesData);
        }, (error) => {
            console.error("Error fetching rules:", error);
            setMessage("Error fetching rules.");
        });

        return () => unsubscribe();
    }, [db, userId, appId]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setNewRule(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!db || !userId) {
            setMessage("Firebase not initialized or user not authenticated.");
            return;
        }

        const rulesCollectionRef = getRulesCollectionRef();
        if (!rulesCollectionRef) return;

        try {
            if (editingRule) {
                // Update existing rule
                const ruleDocRef = doc(rulesCollectionRef, editingRule.id);
                await updateDoc(ruleDocRef, {
                    ...newRule,
                    lastModifiedAt: new Date().toISOString(),
                });
                setMessage('Rule updated successfully!');
                setEditingRule(null);
            } else {
                // Add new rule
                await addDoc(rulesCollectionRef, {
                    ...newRule,
                    createdAt: new Date().toISOString(),
                    createdBy: userId,
                });
                setMessage('Rule added successfully!');
            }
            setNewRule({
                name: '',
                type: 'Naming Convention',
                platform: 'Facebook Ads',
                condition: '',
                message: '',
                isActive: true,
            });
            setIsModalOpen(false); // Close modal after submission
        } catch (e) {
            console.error("Error adding/updating rule:", e);
            setMessage(`Error: ${e.message}`);
        }
    };

    const handleEdit = (rule) => {
        setEditingRule(rule);
        setNewRule({ ...rule }); // Populate form with rule data
        setIsModalOpen(true); // Open modal for editing
    };

    const handleDelete = async (id) => {
        if (!db || !userId) return;
        const rulesCollectionRef = getRulesCollectionRef();
        if (!rulesCollectionRef) return;

        if (window.confirm("Are you sure you want to delete this rule?")) {
            try {
                await deleteDoc(doc(rulesCollectionRef, id));
                setMessage('Rule deleted successfully!');
            } catch (e) {
                console.error("Error deleting rule:", e);
                setMessage(`Error: ${e.message}`);
            }
        }
    };

    // LLM Integration: Suggest Rule Details
    const handleSuggestRuleDetails = async () => {
        if (!newRule.name || !newRule.type) {
            setMessage("Please provide a Rule Name and Type to get suggestions.");
            return;
        }

        setLlmLoading(true);
        setMessage('');

        try {
            const prompt = `Generate a suitable "condition" (e.g., regex for naming, min/max for budget, specific value for targeting) and a "violation message" for a rule with the following details:
            Rule Name: "${newRule.name}"
            Rule Type: "${newRule.type}"
            
            Provide the output as a JSON object with two keys: "condition" and "message".
            Example for Naming Convention: {"condition": "^[A-Z]{3}_[0-9]{4}$", "message": "Campaign name must start with 3 uppercase letters, followed by an underscore and 4 digits (e.g., ABC_1234)."}
            Example for Budget Limit (Min $100, Max $1000): {"condition": "100-1000", "message": "Budget must be between $100 and $1000."}
            Example for Targeting Parameter (Age 18-65): {"condition": "18-65", "message": "Targeting age must be between 18 and 65."}
            `;

            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });
            const payload = {
                contents: chatHistory,
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "OBJECT",
                        properties: {
                            "condition": { "type": "STRING" },
                            "message": { "type": "STRING" }
                        },
                        "propertyOrdering": ["condition", "message"]
                    }
                }
            };

            const apiKey = ""; // Leave as empty string, Canvas will provide it
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const json = result.candidates[0].content.parts[0].text;
                const parsedJson = JSON.parse(json);

                setNewRule(prev => ({
                    ...prev,
                    condition: parsedJson.condition || prev.condition,
                    message: parsedJson.message || prev.message,
                }));
                setMessage('Suggestions applied!');
            } else {
                setMessage('Could not get suggestions from LLM. Please try again.');
                console.error("LLM response structure unexpected:", result);
            }
        } catch (e) {
            console.error("Error calling LLM:", e);
            setMessage(`Error generating suggestions: ${e.message}`);
        } finally {
            setLlmLoading(false);
        }
    };


    return (
        <div className="p-6 bg-white rounded-lg shadow-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">Rule Management</h2>
            {message && <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md">{message}</div>}

            <button
                onClick={() => {
                    setEditingRule(null);
                    setNewRule({
                        name: '',
                        type: 'Naming Convention',
                        platform: 'Facebook Ads',
                        condition: '',
                        message: '',
                        isActive: true,
                    });
                    setIsModalOpen(true);
                }}
                className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-200 ease-in-out mb-6"
            >
                Create New Rule
            </button>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingRule ? "Edit Rule" : "Create New Rule"}>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="name" className="block text-sm font-medium text-gray-700">Rule Name</label>
                        <input
                            type="text"
                            id="name"
                            name="name"
                            value={newRule.name}
                            onChange={handleChange}
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="type" className="block text-sm font-medium text-gray-700">Rule Type</label>
                        <select
                            id="type"
                            name="type"
                            value={newRule.type}
                            onChange={handleChange}
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        >
                            <option>Naming Convention</option>
                            <option>Budget Limit</option>
                            <option>Targeting Parameter</option>
                            <option>Creative Asset Requirement</option>
                            <option>Scheduling Constraint</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="platform" className="block text-sm font-medium text-gray-700">Platform</label>
                        <select
                            id="platform"
                            name="platform"
                            value={newRule.platform}
                            onChange={handleChange}
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        >
                            <option>Facebook Ads</option>
                            <option>Google Ads</option>
                            <option>LinkedIn Ads</option>
                            <option>YouTube Ads</option>
                            <option>Instagram Ads</option>
                            <option>Reddit Ads</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="condition" className="block text-sm font-medium text-gray-700">Condition (e.g., Regex for Naming, Min/Max for Budget)</label>
                        <input
                            type="text"
                            id="condition"
                            name="condition"
                            value={newRule.condition}
                            onChange={handleChange}
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            placeholder="e.g., ^[A-Z]{3}_"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="message" className="block text-sm font-medium text-gray-700">Violation Message</label>
                        <textarea
                            id="message"
                            name="message"
                            value={newRule.message}
                            onChange={handleChange}
                            rows="3"
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            required
                        ></textarea>
                    </div>
                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="isActive"
                            name="isActive"
                            checked={newRule.isActive}
                            onChange={handleChange}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="isActive" className="ml-2 block text-sm text-gray-900">Active</label>
                    </div>
                    <div className="flex justify-between items-center pt-4">
                        <button
                            type="button"
                            onClick={handleSuggestRuleDetails}
                            disabled={llmLoading}
                            className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-md shadow-sm hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition duration-200 ease-in-out flex items-center"
                        >
                            {llmLoading ? (
                                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : (
                                '✨ Suggest Rule Details ✨'
                            )}
                        </button>
                        <div className="flex space-x-3">
                            <button
                                type="button"
                                onClick={() => setIsModalOpen(false)}
                                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                            >
                                {editingRule ? "Update Rule" : "Add Rule"}
                            </button>
                        </div>
                    </div>
                </form>
            </Modal>

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Platform</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Condition</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Active</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {rules.length === 0 ? (
                            <tr>
                                <td colSpan="6" className="px-6 py-4 whitespace-nowrap text-center text-gray-500">No rules defined yet.</td>
                            </tr>
                        ) : (
                            rules.map((rule) => (
                                <tr key={rule.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{rule.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{rule.type}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{rule.platform}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{rule.condition}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${rule.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                            {rule.isActive ? 'Yes' : 'No'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                        <button
                                            onClick={() => handleEdit(rule)}
                                            className="text-indigo-600 hover:text-indigo-900 mr-4"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => handleDelete(rule.id)}
                                            className="text-red-600 hover:text-red-900"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// Violation Tracking Component (Simplified)
const ViolationTracking = () => {
    const { db, userId } = useFirebase();
    const [violations, setViolations] = useState([]);
    const [filterPlatform, setFilterPlatform] = useState('All');
    const [filterUser, setFilterUser] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [message, setMessage] = useState('');
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    // Firestore collection path for violations
    const getViolationsCollectionRef = () => {
        if (!db || !userId) return null;
        return collection(db, `artifacts/${appId}/users/${userId}/violations`);
    };

    // Fetch violations from Firestore
    useEffect(() => {
        const violationsCollectionRef = getViolationsCollectionRef();
        if (!violationsCollectionRef) return;

        const unsubscribe = onSnapshot(violationsCollectionRef, (snapshot) => {
            const violationsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setViolations(violationsData);
        }, (error) => {
            console.error("Error fetching violations:", error);
            setMessage("Error fetching violations.");
        });

        return () => unsubscribe();
    }, [db, userId, appId]);

    const handleAddSimulatedViolation = async () => {
        if (!db || !userId) {
            setMessage("Firebase not initialized or user not authenticated.");
            return;
        }
        const violationsCollectionRef = getViolationsCollectionRef();
        if (!violationsCollectionRef) return;

        const simulatedViolation = {
            timestamp: new Date().toISOString(),
            ruleName: `Simulated Rule ${Math.floor(Math.random() * 100)}`,
            userId: userId, // Use the current user's ID
            campaignId: `CMP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
            platform: ['Facebook Ads', 'Google Ads', 'LinkedIn Ads'][Math.floor(Math.random() * 3)],
            fieldName: ['Campaign Name', 'Budget', 'Targeting Age'][Math.floor(Math.random() * 3)],
            originalValue: 'Invalid Value',
            suggestedCorrection: 'Please correct the value.',
            status: 'Detected',
        };

        try {
            await addDoc(violationsCollectionRef, simulatedViolation);
            setMessage('Simulated violation added!');
        } catch (e) {
            console.error("Error adding simulated violation:", e);
            setMessage(`Error: ${e.message}`);
        }
    };

    const filteredViolations = violations.filter(violation => {
        const matchesPlatform = filterPlatform === 'All' || violation.platform === filterPlatform;
        const matchesUser = filterUser === '' || violation.userId.toLowerCase().includes(filterUser.toLowerCase());
        const matchesSearch = searchTerm === '' ||
            Object.values(violation).some(value =>
                String(value).toLowerCase().includes(searchTerm.toLowerCase())
            );
        return matchesPlatform && matchesUser && matchesSearch;
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Sort by timestamp, most recent first

    return (
        <div className="p-6 bg-white rounded-lg shadow-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">Violation Tracking Dashboard</h2>
            {message && <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md">{message}</div>}

            <div className="mb-6 flex flex-wrap gap-4 items-center">
                <button
                    onClick={handleAddSimulatedViolation}
                    className="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition duration-200 ease-in-out"
                >
                    Add Simulated Violation
                </button>

                <div className="flex-grow">
                    <label htmlFor="filterPlatform" className="sr-only">Filter by Platform</label>
                    <select
                        id="filterPlatform"
                        value={filterPlatform}
                        onChange={(e) => setFilterPlatform(e.target.value)}
                        className="block w-full md:w-auto px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    >
                        <option value="All">All Platforms</option>
                        <option value="Facebook Ads">Facebook Ads</option>
                        <option value="Google Ads">Google Ads</option>
                        <option value="LinkedIn Ads">LinkedIn Ads</option>
                        <option value="YouTube Ads">YouTube Ads</option>
                        <option value="Instagram Ads">Instagram Ads</option>
                        <option value="Reddit Ads">Reddit Ads</option>
                    </select>
                </div>

                <div className="flex-grow">
                    <label htmlFor="filterUser" className="sr-only">Filter by User ID</label>
                    <input
                        type="text"
                        id="filterUser"
                        placeholder="Filter by User ID"
                        value={filterUser}
                        onChange={(e) => setFilterUser(e.target.value)}
                        className="block w-full md:w-auto px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                </div>

                <div className="flex-grow">
                    <label htmlFor="searchTerm" className="sr-only">Search Violations</label>
                    <input
                        type="text"
                        id="searchTerm"
                        placeholder="Search all fields..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="block w-full md:w-auto px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rule Name</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User ID</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Platform</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Field Name</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Original Value</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Suggested Correction</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {filteredViolations.length === 0 ? (
                            <tr>
                                <td colSpan="8" className="px-6 py-4 whitespace-nowrap text-center text-gray-500">No violations found.</td>
                            </tr>
                        ) : (
                            filteredViolations.map((violation) => (
                                <tr key={violation.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(violation.timestamp).toLocaleString()}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{violation.ruleName}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{violation.userId}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{violation.platform}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{violation.fieldName}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{violation.originalValue}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{violation.suggestedCorrection}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${violation.status === 'Detected' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                                            {violation.status}
                                        </span>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// Main App Component
const App = () => {
    const { userId } = useFirebase();
    const [activeTab, setActiveTab] = useState('rules'); // 'rules' or 'violations'

    return (
        <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
            <style>
                {`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
                body {
                    font-family: 'Inter', sans-serif;
                }
                /* Custom styles for rounded corners on all elements */
                * {
                    border-radius: 0.375rem; /* Equivalent to Tailwind's rounded-md */
                }
                /* Specific adjustments for input/select elements */
                input, select, textarea, button {
                    border-radius: 0.375rem;
                }
                table {
                    border-collapse: separate;
                    border-spacing: 0;
                }
                th:first-child {
                    border-top-left-radius: 0.375rem;
                }
                th:last-child {
                    border-top-right-radius: 0.375rem;
                }
                tr:last-child td:first-child {
                    border-bottom-left-radius: 0.375rem;
                }
                tr:last-child td:last-child {
                    border-bottom-right-radius: 0.375rem;
                }
                `}
            </style>
            <header className="bg-blue-700 text-white p-4 shadow-lg">
                <div className="container mx-auto flex flex-col md:flex-row justify-between items-center">
                    <h1 className="text-3xl font-bold mb-2 md:mb-0">Capsule Admin</h1>
                    {userId && (
                        <div className="text-sm bg-blue-800 px-3 py-1 rounded-full">
                            User ID: <span className="font-mono">{userId}</span>
                        </div>
                    )}
                </div>
            </header>

            <nav className="bg-blue-600 text-white shadow-md">
                <div className="container mx-auto flex justify-center py-3">
                    <button
                        onClick={() => setActiveTab('rules')}
                        className={`px-6 py-2 text-lg font-medium transition-colors duration-200 ${activeTab === 'rules' ? 'bg-blue-800 text-white shadow-inner rounded-md' : 'hover:bg-blue-700 rounded-md'}`}
                    >
                        Rule Management
                    </button>
                    <button
                        onClick={() => setActiveTab('violations')}
                        className={`ml-4 px-6 py-2 text-lg font-medium transition-colors duration-200 ${activeTab === 'violations' ? 'bg-blue-800 text-white shadow-inner rounded-md' : 'hover:bg-blue-700 rounded-md'}`}
                    >
                        Violation Tracking
                    </button>
                </div>
            </nav>

            <main className="container mx-auto p-4 md:p-8">
                {activeTab === 'rules' && <RuleManagement />}
                {activeTab === 'violations' && <ViolationTracking />}
            </main>
        </div>
    );
};

// Wrap App with FirebaseProvider
const WrappedApp = () => (
    <FirebaseProvider>
        <App />
    </FirebaseProvider>
);

export default WrappedApp;

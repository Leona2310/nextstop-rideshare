const express = require('express');
const axios = require('axios');
const cors = require('cors');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json());

app.post('/send-notification', async (req, res) => {
	try {
		const { tokens, title, body } = req.body || {};

		if (!Array.isArray(tokens) || tokens.length === 0) {
			return res.status(400).json({ error: 'tokens must be a non-empty array' });
		}
		if (!title || typeof title !== 'string') {
			return res.status(400).json({ error: 'title must be a string' });
		}
		if (!body || typeof body !== 'string') {
			return res.status(400).json({ error: 'body must be a string' });
		}

		// Prepare requests
		const requests = tokens.map((token) => {
			const payload = {
				to: token,
				sound: 'default',
				title,
				body,
			};
			// Detailed logging for debugging
			console.log('Sending to token:', token);
			return axios.post('https://exp.host/--/api/v2/push/send', payload, {
				headers: { 'Content-Type': 'application/json' },
				timeout: 10000,
			}).then(r => {
				console.log('Expo response:', r.data);
				return ({ token, status: 'ok', data: r.data });
			}).catch(err => {
				// Log full error for inspection
				console.log('Expo error:', err.response && err.response.data ? err.response.data : err.message);
				return ({ token, status: 'error', error: err.response ? (err.response.data || err.response.statusText) : err.message });
			});
		});

		const results = await Promise.all(requests);

		const summary = {
			total: tokens.length,
			success: results.filter(r => r.status === 'ok').length,
			failure: results.filter(r => r.status === 'error').length,
			results,
		};

	console.log('Notification Summary:', summary);
	return res.json(summary);
	} catch (err) {
		console.error('send-notification error', err);
		return res.status(500).json({ error: 'Internal server error' });
	}
});

app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});


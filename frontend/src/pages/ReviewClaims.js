import React, {
  useEffect,
  useState
} from "react";
import { useNavigate } from "react-router-dom";

import "./reviewclaims.css";

import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import BackButton from "../components/BackButton";
import ApproveClaimModal from "../components/ApproveClaimModal";


function ReviewClaims() {
  const navigate = useNavigate();

  const [claims, setClaims] =
    useState([]);

  const [confirmAction, setConfirmAction] =
    useState(null);

  const [approveClaimId, setApproveClaimId] =
    useState(null);

  const [approving, setApproving] =
    useState(false);

  const {
    success,
    error
  } = useToast();


  useEffect(() => {
    fetchClaims();
  }, []);


  const fetchClaims = async () => {

    try {

      const token =
        localStorage.getItem("token");

      const res = await fetch(
        "http://localhost:5000/api/claims",
        {
          headers: {
            Authorization:
              `Bearer ${token}`
          }
        }
      );

      const data =
        await res.json();

      if (!res.ok) {
        throw new Error(
          data.error ||
          "Failed to load claims"
        );
      }

      setClaims(
        data.filter(
          (claim) =>
            claim.status === "pending" ||
            claim.status === "additional_info_requested"
        )
      );

    } catch (err) {

      error(
        err.message ||
        "Failed to load claim requests"
      );

    }
  };


  const approveClaim = async (
    id,
    contactDetails
  ) => {

    try {

      setApproving(true);

      const token =
        localStorage.getItem("token");

      const res = await fetch(
        `http://localhost:5000/api/claims/${id}/approve`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization:
              `Bearer ${token}`
          },

          body: JSON.stringify(
            contactDetails
          )
        }
      );

      const data =
        await res.json();

      if (!res.ok) {
        throw new Error(
          data.error ||
          "Failed to approve claim"
        );
      }

      setApproveClaimId(null);

      success(
        "Claim approved and contact details shared with the claimant."
      );

      fetchClaims();

    } catch (err) {

      error(
        err.message ||
        "Failed to approve claim"
      );

    } finally {

      setApproving(false);

    }

  };


  const requestInfoClaim = async (id) => {
    try {
      const token = localStorage.getItem("token");

      const res = await fetch(
        `http://localhost:5000/api/claims/${id}/request-info`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to request additional info");
      }

      success(
        "Requested additional info from claimant. An 'Additional Info' chat conversation is now active."
      );

      fetchClaims();

    } catch (err) {
      error(err.message || "Failed to request additional info");
    }
  };


  const rejectClaim = async (id) => {

    try {

      const token =
        localStorage.getItem("token");

      const res = await fetch(
        `http://localhost:5000/api/claims/${id}/reject`,
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${token}`
          }
        }
      );

      const data =
        await res.json();

      if (!res.ok) {
        throw new Error(
          data.error ||
          "Failed to reject claim"
        );
      }

      success(
        "The claim has been rejected."
      );

      fetchClaims();

    } catch (err) {

      error(
        err.message ||
        "Failed to reject claim"
      );

    }

  };


  const handleApprove = (id) => {

    setApproveClaimId(id);

  };


  const handleReject = (id) => {

    setConfirmAction({
      type: "reject",
      id
    });

  };


  const handleConfirm = async () => {

    if (!confirmAction) {
      return;
    }

    const {
      type,
      id
    } = confirmAction;

    setConfirmAction(null);

    if (type === "reject") {

      await rejectClaim(id);

    }

  };


  return (
    <div className="review-container">

      <BackButton fallback="/dashboard" />

      <h1>
        Claim Requests
      </h1>


      <div className="claims-grid">

        {claims.length === 0 ? (

          <div className="empty-state">

            <div className="empty-icon">
              📭
            </div>

            <h2>
              No Pending Claims
            </h2>

            <p>
              There are currently no claim
              requests waiting for review.
            </p>

          </div>

        ) : (

          claims.map((claim) => (

            <div
              className="claim-card"
              key={claim.id}
            >

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2>
                  {claim.title}
                </h2>
                {claim.status === "additional_info_requested" && (
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: '600',
                    background: 'rgba(245, 158, 11, 0.18)',
                    color: '#fbbf24',
                    border: '1px solid rgba(245, 158, 11, 0.3)'
                  }}>
                    ℹ️ Info Requested
                  </span>
                )}
              </div>


              <p>
                <b>Category:</b>
                {" "}
                {claim.category}
              </p>


              <p>
                <b>Claimant:</b>
                {" "}
                {claim.claimer_id}
              </p>


              <p>
                <b>Reason:</b>
                {" "}
                {claim.claim_reason}
              </p>


              <p>
                <b>Identifier:</b>
                {" "}
                {claim.identifier_description}
              </p>


              <p>
                <b>Lost Location:</b>
                {" "}
                {claim.lost_location}
              </p>


              <p>
                <b>Lost Date:</b>
                {" "}
                {claim.lost_date}
              </p>


              <p>
                <b>Additional Proof:</b>
                {" "}
                {claim.additional_proof}
              </p>


              <hr />


              <p>
                <b>
                  Hidden Verification:
                </b>
              </p>


              <p>
                {claim.verification_detail}
              </p>


              <div className="actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>

                <button
                  className="approve-btn"
                  onClick={() =>
                    handleApprove(
                      claim.id
                    )
                  }
                >
                  Approve
                </button>

                <button
                  className="req-info-btn"
                  onClick={() =>
                    requestInfoClaim(
                      claim.id
                    )
                  }
                >
                  Request Info
                </button>

                <button
                  className="reject-btn"
                  onClick={() =>
                    handleReject(
                      claim.id
                    )
                  }
                >
                  Reject
                </button>

                {claim.status === "additional_info_requested" && (
                  <button
                    className="chat-btn"
                    onClick={() =>
                      navigate(`/chat?claimId=${claim.id}`)
                    }
                    style={{ width: '100%', marginTop: '4px' }}
                  >
                    💬 Open Chat with Claimant
                  </button>
                )}

              </div>

            </div>

          ))

        )}

      </div>


      {/* APPROVE CLAIM MODAL */}

      <ApproveClaimModal
        open={approveClaimId !== null}

        loading={approving}

        onConfirm={(contactDetails) =>
          approveClaim(
            approveClaimId,
            contactDetails
          )
        }

        onCancel={() =>
          setApproveClaimId(null)
        }
      />


      {/* REJECT CONFIRMATION MODAL */}

      <ConfirmModal
        open={!!confirmAction}

        title="Reject Claim?"

        message="Are you sure you want to reject this ownership claim?"

        confirmText="Reject Claim"

        cancelText="Cancel"

        onConfirm={
          handleConfirm
        }

        onCancel={() =>
          setConfirmAction(null)
        }
      />

    </div>
  );
}


export default ReviewClaims;